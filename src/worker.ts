import { D1Database, R2Bucket } from '@cloudflare/workers-types/experimental'
import { Methods, Trouter } from 'trouter'
import { parse } from 'cookie'
import { Resend } from 'resend'
import { modelController } from './controllers/default'
import { productsController } from './controllers/products'

export type ModelController = {
    list: (
        listParameters: {
            prefix: string
            limit: number
            after: any
        },
        parameters: Parameters
    ) => Promise<{ results: { name: string; modified_at: number }[]; last: any }>
    exists: (name: string, parameters: Parameters) => Promise<Boolean>
    get: (name: string, parameters: Parameters) => Promise<{ value: any; modified_at: number } | undefined | null>
    put: (
        putParameters: { name: string; rename: string; value: any; modified_by: string },
        parameters: Parameters
    ) => Promise<void>
    delete: (name: string, parameters: Parameters) => Promise<void>
}

/**
 * Use controllers to override default model behavior and integrate with external APIs
 */
const controllers: Record<string, ModelController> = {
    default: modelController,
    products: productsController
}

type Environment = {
    DB: D1Database
    FILES: R2Bucket
    RESEND_KEY?: string
    BIGCOMMERCE_HASH?: string
    BIGCOMMERCE_TOKEN?: string
}

type Parameters = {
    environment: Environment
    url: URL
    headers: Record<string, string>
    queries: Record<string, string>
    parameters: Record<string, string>
    body?: any
    user: string | false
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

export const time = () => Math.floor(Date.now() / 1000)

const defaultLimit = 20
const lastHeader = 'x-last'
const tokenPrefix = `Bearer `

const router = new Trouter()

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
    if (!parameters.user) return responses.unauthorized
    return responses.json({ email: parameters.user })
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
    if (!parameters.user) return responses.unauthorized

    const { session } = parse(parameters.headers?.cookie ?? '')
    if (session)
        return responses.success(
            await parameters.environment.DB.prepare('delete from sessions where key = ?').bind(session).run()
        )
    return responses.badRequest()
})

// Documents

router.get('/documents/:model', async (request: Request, parameters: Parameters) => {
    const model = parameters.parameters?.model ?? ''
    if (!parameters.user) return responses.unauthorized

    const prefix = parameters.queries?.prefix
    const limit = parameters.queries?.limit ? Number(parameters.queries.limit) : defaultLimit
    const after = parameters.queries?.after ? Number(parameters.queries.after) : 0

    const controller = controllers[model] ?? controllers.default
    const result = await controller.list({ prefix, limit, after }, parameters)

    const headers = {}
    if (result.last) headers[lastHeader] = result.last
    return responses.json(result.results, headers)
})

router.head('/document/:model/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const { model, '*': name } = parameters.parameters
    if (!model || !name) return responses.badRequest()

    const controller = controllers[model] ?? controllers.default
    const result = await controller.exists(decodeURI(name), parameters)

    if (!result) return responses.notFound
    return responses.noContent
})

router.get('/document/:model/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const { model, '*': name } = parameters.parameters
    if (!model || !name) return responses.badRequest()

    const controller = controllers[model] ?? controllers.default
    const result = await controller.get(decodeURI(name), parameters)

    if (!result) return responses.notFound
    return responses.json(result)
})

router.put('/document/:model/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const { model, '*': name } = parameters.parameters
    if (!model || !name) return responses.badRequest()
    const rename = parameters.queries?.rename
    const value = parameters.body
    if (!value) return responses.badRequest()

    const controller = controllers[model] ?? controllers.default
    await controller.put({ name: decodeURI(name), rename, value, modified_by: parameters.user }, parameters)
})

router.delete('/document/:model/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const { model, '*': name } = parameters.parameters
    if (!model || !name) return responses.badRequest()

    const controller = controllers[model] ?? controllers.default
    await controller.delete(decodeURI(name), parameters)
})

// Files

router.get('/files/', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

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

    const result = await parameters.environment.FILES.get(decodeURI(key))
    // TODO: add public/private flag

    if (!result) return responses.notFound
    // @ts-ignore
    return new Response(result.body, { headers: { 'content-type': result.customMetadata?.content_type } })
})

router.head('/file/*', async (request: Request, parameters: Parameters) => {
    const key = parameters.parameters['*'] as string | undefined
    if (!key) return responses.notFound

    const result = await parameters.environment.FILES.get(decodeURI(key))
    // TODO: add public/private flag

    if (!result) return responses.notFound
    // @ts-ignore
    return responses.noContent
})

router.put('/file/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const key = parameters.parameters['*'] as string | undefined
    if (!key) return responses.badRequest()
    // @ts-ignore
    await parameters.environment.FILES.put(decodeURI(key), request.body, {
        customMetadata: { uploaded_by: parameters.user, content_type: parameters.headers['content-type'] }
    })
    return responses.noContent
})

router.delete('/file/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const key = parameters.parameters['*'] as string | undefined
    if (!key) return responses.badRequest()
    await parameters.environment.FILES.delete(decodeURI(key))
    return responses.noContent
})

// Users

router.get('/users/', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

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
    if (!parameters.user) return responses.unauthorized

    const email = parameters.body?.email
    if (!email) return responses.badRequest()

    return responses.success(
        await parameters.environment.DB.prepare('insert into users (email, key) values (?, ?)')
            .bind(email, crypto.randomUUID())
            .run()
    )
})

router.delete('/user/', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const email = parameters.queries?.email
    if (!email || email === parameters.user) return responses.badRequest()

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

                let user: string | false = false
                const { session } = parse(headers?.cookie ?? '')
                const token =
                    headers?.authorization && headers.authorization.startsWith(tokenPrefix)
                        ? headers.authorization.slice(tokenPrefix.length)
                        : undefined

                if (session)
                    user =
                        (await environment.DB.prepare(
                            'select sessions.email from sessions inner join users on users.email = sessions.email where sessions.key = ? and sessions.expires_at > ?'
                        )
                            .bind(session, time())
                            .first<string>('email')) ?? false
                else if (token)
                    user =
                        (await environment.DB.prepare('select email from users where key = ?')
                            .bind(token)
                            .first<string>('email')) ?? false

                return await handler(request, {
                    environment,
                    url,
                    headers,
                    queries: Object.fromEntries(url.searchParams.entries()),
                    parameters: match.params,
                    body,
                    user
                })
            } catch (e) {
                // TODO: Email/Slack error notification
                console.error(e)
                return new Response(undefined, { status: 500 })
            }

        return responses.notFound
    }
}
