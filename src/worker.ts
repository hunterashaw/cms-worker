import { D1Database, D1Result, R2Bucket } from '@cloudflare/workers-types/experimental'
import { Methods, Trouter } from 'trouter'
import { parse } from 'cookie'
import { Resend } from 'resend'

type Environment = {
    DB: D1Database
    FILES: R2Bucket
    RESEND_KEY?: string
}

type Parameters = {
    environment: Environment
    url: URL
    headers: Record<string, string>
    queries: Record<string, string>
    parameters: Record<string, string>
    body?: any
}

export type Endpoint = (request: Request, parameters: Parameters) => Response | Promise<Response>

export const responses = {
    badRequest: (message = '') => new Response(message, { status: 400 }),
    unauthorized: new Response(undefined, { status: 401 }),
    json: (payload: any, headers?: Record<string, string | undefined>) =>
        new Response(JSON.stringify(payload), { headers: { 'content-type': 'application/json', ...headers } }),
    notFound: new Response(undefined, { status: 404 }),
    success: ({ success }) => new Response(undefined, { status: Boolean(success) ? 200 : 500 }),
    noContent: new Response(undefined, { status: 204 })
}

const time = () => Math.floor(Date.now() / 1000)

const defaultLimit = 20
const lastHeader = 'x-last'
const tokenPrefix = `Bearer `

const router = new Trouter()

export async function authenticate(request: Request, parameters: Parameters) {
    const { session } = parse(parameters.headers?.cookie ?? '')
    const token =
        parameters.headers?.authorization && parameters.headers.authorization.startsWith(tokenPrefix)
            ? parameters.headers.authorization.slice(tokenPrefix.length)
            : undefined
    if (!session && !token) return false

    let user: string | null
    if (session)
        user = await parameters.environment.DB.prepare(
            'select sessions.email from sessions inner join users on users.email = sessions.email where sessions.key = ? and sessions.expires_at > ?'
        )
            .bind(session, time())
            .first<string>('email')
    else
        user = await parameters.environment.DB.prepare('select email from users where key = ?')
            .bind(token)
            .first<string>('email')

    if (!user) return false
    return user
}

router.post('/verification', async (request: Request, parameters: Parameters) => {
    const email = parameters?.body?.email
    const now = time()

    await parameters.environment.DB.prepare(
        'update users set verification = ?, verification_expires_at = ? where email = ? and (verification_expires_at is null or verification_expires_at <= ?)'
    )
        .bind(
            crypto
                .getRandomValues(new Uint8Array(8))
                .map(value => value % 10)
                .join(''),
            now + 300,
            email,
            now
        )
        .run()

    const verification = await parameters.environment.DB.prepare('select verification from users where email = ?')
        .bind(email)
        .first<string>('verification')

    if (parameters.environment.RESEND_KEY) {
        const resend = new Resend(parameters.environment.RESEND_KEY)
        const emailResult = await resend.emails.send({
            from: 'develop@resend.dev',
            to: email,
            subject: 'CMS Verification Code',
            text: `Verification code: ${verification}`
        })
        if (emailResult.error) throw new Error(emailResult.error.message)
    } else console.log('New user verification:', { email, verification })

    return responses.noContent
})

// Sessions

router.get('/session', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized
    return responses.json({ email: user })
})

router.post('/session', async (request: Request, parameters: Parameters) => {
    const email = parameters?.body?.email
    const verification = parameters?.body?.verification
    const now = time()

    const existing = await parameters.environment.DB.prepare(
        'select email from users where email = ? and verification = ? and verification_expires_at > ?'
    )
        .bind(email, verification, now)
        .first<string>('email')

    if (!existing) return responses.unauthorized

    await parameters.environment.DB.prepare('delete from sessions where email = ? and expires_at < ?')
        .bind(email, now)
        .run()
    const key = crypto.randomUUID()
    const expires_at = now + 259200 // 3 days

    await parameters.environment.DB.prepare('insert into sessions (key, email, expires_at) values (?, ?, ?)')
        .bind(key, email, expires_at)
        .run()
    return new Response(undefined, { status: 201, headers: { 'set-cookie': `session=${key}; SameSite=Strict` } })
})

router.delete('/session', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const { session } = parse(parameters.headers?.cookie ?? '')
    if (session)
        return responses.success(
            await parameters.environment.DB.prepare('delete from sessions where key = ?').bind(session).run()
        )
    return responses.badRequest()
})

// Documents

router.get('/documents/:model', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    const model = parameters.parameters?.model ?? ''
    if (!user) return responses.unauthorized

    const prefix = parameters.queries?.prefix
    const limit = parameters.queries?.limit ? Number(parameters.queries.limit) : defaultLimit
    const after = parameters.queries?.after ? Number(parameters.queries.after) : 0

    let result: D1Result<{ rowid: number; name: string; created_at: number; modified_at: number; modified_by: string }>
    if (prefix)
        result = await parameters.environment.DB.prepare(
            'select rowid, name, created_at, modified_at, modified_by from documents where model = ? and name glob ? and rowid > ? order by name, rowid limit ?'
        )
            .bind(model, `${prefix}*`, after, limit)
            .all<{ rowid: number; name: string; created_at: number; modified_at: number; modified_by: string }>()
    else
        result = await parameters.environment.DB.prepare(
            'select rowid, name, created_at, modified_at, modified_by from documents where model = ? and rowid > ? order by modified_at, rowid limit ?'
        )
            .bind(model, after, limit)
            .all<{ rowid: number; name: string; created_at: number; modified_at: number; modified_by: string }>()

    const last = result.results.length ? result.results[result.results.length - 1]?.rowid?.toString() : undefined
    const headers = {}
    if (result.results.length === limit && last) headers[lastHeader] = last
    return responses.json(result.results, headers)
})

router.head('/document/:model/:name', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const { model, name } = parameters.parameters
    if (!model || !name) return responses.badRequest()

    const result = await parameters.environment.DB.prepare(
        'select created_at from documents where model = ? and name = ?'
    )
        .bind(model, name)
        .first<{ created_at: number }>()

    if (!result) return responses.notFound
    return responses.noContent
})

router.get('/document/:model/:name', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const { model, name } = parameters.parameters
    if (!model || !name) return responses.badRequest()

    const result = await parameters.environment.DB.prepare(
        'select value, created_at, modified_at, modified_by from documents where model = ? and name = ?'
    )
        .bind(model, name)
        .first<{ value: string; created_at: number; modified_at: number; modified_by: string }>()

    if (!result) return responses.notFound
    return responses.json({
        value: JSON.parse(result.value),
        created_at: result.created_at,
        modified_at: result.modified_at,
        modified_by: result.modified_by
    })
})

router.put('/document/:model/:name', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const { model, name } = parameters.parameters
    if (!model || !name) return responses.badRequest()
    const value = parameters.body
    if (!value) return responses.badRequest()

    const existing = await parameters.environment.DB.prepare('select rowid from documents where model = ? and name = ?')
        .bind(model, name)
        .first<number>('rowid')
    const rename = parameters.queries?.rename
    if (rename && !existing) return responses.badRequest()
    const now = time()

    if (existing)
        return responses.success(
            await parameters.environment.DB.prepare(
                'update documents set name = ?, value = ?, modified_at = ?, modified_by = ? where rowid = ?'
            )
                .bind(rename ?? name, JSON.stringify(value), now, user, existing)
                .run()
        )

    return responses.success(
        await parameters.environment.DB.prepare(
            'insert into documents (model, name, value, created_at, modified_at, modified_by) values (?, ?, ?, ?, ?, ?)'
        )
            .bind(model, name, JSON.stringify(value), now, now, user)
            .run()
    )
})

router.delete('/document/:model/:name', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const { model, name } = parameters.parameters
    if (!model || !name) return responses.badRequest()

    const existing = await parameters.environment.DB.prepare('select rowid from documents where model = ? and name = ?')
        .bind(model, name)
        .first<number>('rowid')

    if (!existing) return responses.notFound
    return responses.success(
        await parameters.environment.DB.prepare('delete from documents where rowid = ?').bind(existing).run()
    )
})

// Files

router.get('/files/', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const prefix = parameters.queries?.prefix
    const limit = parameters.queries?.limit ? Number(parameters.queries.limit) : defaultLimit
    const after = parameters.queries?.after

    const results = await parameters.environment.FILES.list({
        prefix,
        limit,
        cursor: after,
        include: ['customMetadata']
    })

    const headers = {}
    // @ts-ignore
    if (results?.cursor)
        // @ts-ignore
        headers[lastHeader] = results.cursor

    return responses.json(
        results.objects.map(object => {
            const uploaded = Math.floor(object.uploaded.getTime() / 1000)

            return {
                name: object.key,
                created_at: uploaded,
                modified_by: object.customMetadata?.uploaded_by ?? ''
            }
        }),
        headers
    )
})

router.get('/file/*', async (request: Request, parameters: Parameters) => {
    const key = parameters.parameters['*'] as string | undefined
    if (!key) return responses.notFound

    const result = await parameters.environment.FILES.get(key)
    // TODO: add public/private flag

    if (!result) return responses.notFound
    // @ts-ignore
    return new Response(result.body, { headers: { 'content-type': result.customMetadata?.content_type } })
})

router.head('/file/*', async (request: Request, parameters: Parameters) => {
    const key = parameters.parameters['*'] as string | undefined
    if (!key) return responses.notFound

    const result = await parameters.environment.FILES.get(key)
    // TODO: add public/private flag

    if (!result) return responses.notFound
    // @ts-ignore
    return responses.noContent
})

router.put('/file/*', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const key = parameters.parameters['*'] as string | undefined
    if (!key) return responses.badRequest()
    // @ts-ignore
    await parameters.environment.FILES.put(key, request.body, {
        customMetadata: { uploaded_by: user, content_type: parameters.headers['content-type'] }
    })
    return responses.noContent
})

router.delete('/file/*', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const key = parameters.parameters['*'] as string | undefined
    if (!key) return responses.badRequest()
    await parameters.environment.FILES.delete(key)
    return responses.noContent
})

// Users

router.get('/users/', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const prefix = parameters.queries?.prefix

    if (prefix)
        return responses.json(
            (
                await parameters.environment.DB.prepare('select email from users where email glob ? order by email')
                    .bind(`${prefix}*`)
                    .all<{ email: string }>()
            ).results
        )
    return responses.json(
        (await parameters.environment.DB.prepare('select email from users').all<{ email: string }>()).results
    )
})

router.post('/user/', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const email = parameters.body?.email
    if (!email) return responses.badRequest()

    return responses.success(
        await parameters.environment.DB.prepare('insert into users (email, key) values (?, ?)')
            .bind(email, crypto.randomUUID())
            .run()
    )
})

router.delete('/user/', async (request: Request, parameters: Parameters) => {
    const user = await authenticate(request, parameters)
    if (!user) return responses.unauthorized

    const email = parameters.queries?.email
    if (!email || email === user) return responses.badRequest()

    return responses.success({
        success:
            (await parameters.environment.DB.prepare('delete from users where email = ?').bind(email).run()) &&
            (await parameters.environment.DB.prepare('delete from sessions where email = ?').bind(email).run())
    })
})

export default {
    async fetch(request: Request, environment: Environment) {
        const url = new URL(request.url)
        const match = router.find(request.method as Methods, url.pathname)
        const [handler] = match.handlers as Endpoint[]
        if (handler)
            try {
                let body
                const headers = Object.fromEntries(request.headers.entries())
                if (headers['content-type'] === 'application/json') body = await request.json()

                return await handler(request, {
                    environment,
                    url,
                    headers,
                    queries: Object.fromEntries(url.searchParams.entries()),
                    parameters: match.params,
                    body
                })
            } catch (e) {
                // TODO: Email/Slack error notification
                console.error(e)
                return new Response(undefined, { status: 500 })
            }

        return responses.notFound
    }
}
