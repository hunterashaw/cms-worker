import { D1Database, R2Bucket } from '@cloudflare/workers-types/experimental'
import { Methods, Trouter } from 'trouter'
import { parse as parseCookie } from 'cookie'
import { Resend } from 'resend'
import { defaultController } from './controllers/default'
import { productsController } from './controllers/products'
import { parse as parsePath } from 'regexparam'

export type ModelController = {
    path?: string
    list: (
        listParameters: {
            path: string
            prefix: string
            limit: number
            after: any
        },
        parameters: Parameters
    ) => Promise<{ documents: { name: string; modified_at: number }[]; folders: { name: string }[]; last: any }>
    exists: (existsParameters: { path: string; name: string }, parameters: Parameters) => Promise<Boolean>
    get: (
        getParameters: { path: string; name: string },
        parameters: Parameters
    ) => Promise<{ value: Record<string, any>; blob?: ArrayBuffer } | undefined | null>
    put: (
        putParameters: { path: string; name: string; rename: string; value: Record<string, any>; blob?: ArrayBuffer },
        parameters: Parameters
    ) => Promise<void>
    delete: (deleteParameters: { path: string; name: string }, parameters: Parameters) => Promise<void>
}

/**
 * Use controllers to override default model behavior and integrate with external APIs
 */
const controllers: ModelController[] = [productsController]

type Environment = {
    DB: D1Database
    FILES: R2Bucket
    RESEND_KEY?: string
    BIGCOMMERCE_HASH?: string
    BIGCOMMERCE_TOKEN?: string
    READONLY?: boolean
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
    noContent: new Response(undefined, { status: 204 }),
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
            text: `Verification code: ${verification}`,
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

    await parameters.environment.DB.prepare('delete from sessions where email = ? and expires_at < ?').bind(email, now).run()
    const key = crypto.randomUUID()
    const expires_at = now + 259200 // 3 days

    await parameters.environment.DB.prepare('insert into sessions (key, email, expires_at) values (?, ?, ?)')
        .bind(key, email, expires_at)
        .run()
    return new Response(undefined, { status: 201, headers: { 'set-cookie': `session=${key}; SameSite=Strict` } })
})

router.delete('/session', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const { session } = parseCookie(parameters.headers?.cookie ?? '')
    if (session) return responses.success(await parameters.environment.DB.prepare('delete from sessions where key = ?').bind(session).run())
    return responses.badRequest()
})

// New Documents

function getPathName(key: string | undefined) {
    if (!key) return { path: '' }

    const pieces = key.split('/')
    const name = pieces.pop()
    return { path: decodeURI(pieces.join('/')), name: name !== undefined ? decodeURI(name) : undefined }
}

function getController(path: string): ModelController {
    return controllers.find(controller => controller.path && parsePath(controller.path).pattern.test(path)) ?? defaultController
}

router.head('/documents/*', async (request: Request, parameters: Parameters) => {
    const { path, name } = getPathName(parameters.parameters['*'])
    if (!name) return responses.notFound
    const controller = getController(path)

    const result = await controller.exists({ path, name }, parameters)
    if (!result) return responses.notFound
    return responses.noContent
})

router.get('/documents/*', async (request: Request, parameters: Parameters) => {
    const { path, name } = getPathName(parameters.parameters['*'])
    const controller = getController(path)

    if (name) {
        const result = await controller.get({ path, name }, parameters)
        if (!result) return responses.notFound

        if (result.blob) {
            if (!result.value?.public && !parameters.user) responses.unauthorized
            return new Response(result.blob, { headers: { 'content-type': result.value['content-type'] } })
        }
        if (!parameters.user) return responses.unauthorized

        return responses.json(result.value)
    }
    if (!parameters.user) return responses.unauthorized

    const prefix = parameters.queries?.prefix
    const limit = parameters.queries?.limit ? Number(parameters.queries.limit) : defaultLimit
    const after = parameters.queries?.after ? Number(parameters.queries.after) : 0

    const { documents, folders, last } = await controller.list({ path, prefix, limit, after }, parameters)

    const headers = {}
    if (last) headers[lastHeader] = last
    return responses.json(
        {
            documents,
            folders,
        },
        headers
    )
})

router.put('/documents/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const { path, name } = getPathName(parameters.parameters['*'])
    if (name === undefined) return responses.badRequest()
    const controller = getController(path)

    const rename = parameters.queries?.rename
    let value = parameters.body
    let blob
    if (!request.bodyUsed) {
        value = request.headers
        blob = await request.arrayBuffer()
    }

    await controller.put({ path, name, rename, value, blob }, parameters)
})

router.delete('/document/*', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const { path, name } = getPathName(parameters.parameters['*'])
    if (name === undefined) return responses.badRequest()
    const controller = getController(path)

    await controller.delete({ path, name }, parameters)
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
    return responses.json((await parameters.environment.DB.prepare('select email from users').all<{ email: string }>()).results)
})

router.post('/user/', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const email = parameters.body?.email
    if (!email) return responses.badRequest()

    return responses.success(
        await parameters.environment.DB.prepare('insert into users (email, key) values (?, ?)').bind(email, crypto.randomUUID()).run()
    )
})

router.delete('/user/', async (request: Request, parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const email = parameters.queries?.email
    if (!email || email === parameters.user) return responses.badRequest()

    return responses.success({
        success:
            (await parameters.environment.DB.prepare('delete from users where email = ?').bind(email).run()) &&
            (await parameters.environment.DB.prepare('delete from sessions where email = ?').bind(email).run()),
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
                const { session } = parseCookie(headers?.cookie ?? '')
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
                        (await environment.DB.prepare('select email from users where key = ?').bind(token).first<string>('email')) ?? false

                return await handler(request, {
                    environment,
                    url,
                    headers,
                    queries: Object.fromEntries(url.searchParams.entries()),
                    parameters: match.params,
                    body,
                    user,
                })
            } catch (e) {
                // TODO: Email/Slack error notification
                console.error(e)
                return new Response(undefined, { status: 500 })
            }

        return responses.notFound
    },
}
