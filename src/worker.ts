import { D1Database, R2Bucket } from '@cloudflare/workers-types/experimental'
import { Methods, Trouter } from 'trouter'
import { parse } from 'cookie'
import { Resend } from 'resend'
import { documentsController, filesController, usersController } from './controllers/default'

export type Controller = {
    list?: (
        listParameters: {
            model: string
            folder?: string
            prefix?: string
            limit: number
            after: any
        },
        parameters: Parameters
    ) => Promise<{ results: { name: string; folder?: string; modified_at?: number }[]; last?: any }>
    listFolders?: (
        listParameters: {
            model: string
        },
        parameters: Parameters
    ) => Promise<string[]>
    exists?: (existsParameters: { model: string; folder: string; name: string }, parameters: Parameters) => Promise<Boolean>
    get?: (
        getParameters: { model: string; folder?: string; name: string },
        parameters: Parameters
    ) => Promise<any | Response | undefined | null>
    put?: (
        putParameters: { model: string; folder?: string; name: string; rename?: string; value: any; modified_by: string; move?: string },
        parameters: Parameters
    ) => Promise<void | boolean>
    delete?: (deleteParameters: { model: string; folder?: string; name: string }, parameters: Parameters) => Promise<void | boolean>
}

/**
 * Use controllers to override default model behavior and integrate with external APIs
 */
const controllers: Record<string, Controller> = {
    documents: documentsController,
    files: filesController,
    users: usersController,
}

type Environment = {
    DB: D1Database
    FILES: R2Bucket
    RESEND_KEY?: string
    DEMO?: boolean
}

type Parameters = {
    request: Request
    environment: Environment
    url: URL
    headers: Record<string, string>
    queries: Record<string, string>
    parameters: Record<string, string>
    body?: Record<string, any> | ReadableStream | null
    user: string | false
    ip: string
}

export type Endpoint = (parameters: Parameters) => Response | Promise<Response>

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
const router = new Trouter()

// Verification

router.post(`/verification`, async (parameters: Parameters) => {
    if (parameters.environment.DEMO) return responses.unauthorized
    // @ts-ignore
    const email = parameters?.body?.email
    const now = time()
    const verification = crypto
        .getRandomValues(new Uint8Array(8))
        .map(value => value % 10)
        .join('')

    await parameters.environment.DB.prepare(
        'update users set verification = ?, verification_expires_at = ? where email = ? and (verification_expires_at is null or verification_expires_at <= ?)'
    )
        .bind(verification, now + 300, email, now)
        .run()

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

router.get(`/session`, async (parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    return responses.json({ email: parameters.user })
})

router.post(`/session`, async (parameters: Parameters) => {
    // @ts-ignore
    const email = parameters?.body?.email
    // @ts-ignore
    const verification = parameters?.body?.verification ?? ''
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
        .bind(`${key}${parameters.ip}`, email, expires_at)
        .run()
    return new Response(undefined, { status: 201, headers: { 'set-cookie': `session=${key}; SameSite=Strict` } })
})

router.delete(`/session`, async (parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const { session } = parse(parameters.headers?.cookie ?? '')
    if (session)
        return responses.success(
            await parameters.environment.DB.prepare('delete from sessions where key = ?').bind(`${session}${parameters.ip}`).run()
        )
    return responses.badRequest()
})

// Documents

router.head(`/:model`, async (parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized

    const model = parameters.parameters?.model
    if (!model) return responses.notFound

    const folder = parameters.queries?.folder ?? ''
    const name = parameters.queries?.name
    if (!name) return responses.badRequest(`'name' query parameter is required.`)

    const controller = controllers[model] ?? controllers.documents
    if (!controller.exists) throw new Error('Document exists not implemented.')
    const result = await controller.exists({ model, folder, name }, parameters)

    if (!result) return responses.notFound
    return responses.noContent
})

router.get(`/:model`, async (parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const model = parameters.parameters?.model
    if (!model) return responses.notFound
    const controller = controllers[model] ?? controllers.documents

    // Get Single Document
    if (parameters.queries?.name) {
        const folder = parameters.queries?.folder ?? ''
        const name = parameters.queries?.name
        if (!name) return responses.badRequest(`'name' query parameter is required.`)

        if (!controller.get) throw new Error('Get document not implemented.')
        const result = await controller.get({ model, folder, name }, parameters)

        if (result instanceof Response) return result
        if (!result) return responses.notFound
        return responses.json(result)
    }

    // List Documents
    const folder = parameters.queries?.folder
    const prefix = parameters.queries?.prefix
    const limit = parameters.queries?.limit ? Number(parameters.queries.limit) : prefix ? 10 : 20
    const after = parameters.queries?.after
        ? isNaN(Number(parameters.queries.after))
            ? parameters.queries.after
            : Number(parameters.queries.after)
        : undefined

    if (!controller.list) throw new Error('List documents not implemented.')
    const result = await controller.list({ model, folder, prefix, limit, after }, parameters)

    const headers = {}
    if (result.last) headers['x-last'] = result.last
    return responses.json(result.results, headers)
})

router.get(`/:model/folders`, async (parameters: Parameters) => {
    if (!parameters.user) return responses.unauthorized
    const model = parameters.parameters?.model
    if (!model) return responses.notFound

    const controller = controllers[model] ?? controllers.documents
    if (!controller.listFolders) throw new Error('List document folders not implemented.')
    const result = await controller.listFolders({ model }, parameters)

    return responses.json(result)
})

router.put(`/:model`, async (parameters: Parameters) => {
    if (!parameters.user || parameters.environment.DEMO) return responses.unauthorized

    const model = parameters.parameters?.model
    if (!model) return responses.notFound

    const folder = parameters.queries?.folder ?? ''
    const name = parameters.queries?.name
    if (!name) return responses.badRequest(`'name' query parameter is required.`)

    const rename = parameters.queries?.rename
    const move = parameters.queries?.move
    const value = parameters.body ?? parameters.request.body
    if (!value) return responses.badRequest('Request body is required.')

    const controller = controllers[model] ?? controllers.documents
    if (!controller.put) throw new Error('Document update not implemented.')
    if (!(await controller.put({ model, folder, name, rename, value, modified_by: parameters.user, move }, parameters)))
        throw new Error('Unable to update document.')
    return responses.noContent
})

router.delete(`/:model`, async (parameters: Parameters) => {
    if (!parameters.user || parameters.environment.DEMO) return responses.unauthorized

    const model = parameters.parameters?.model
    if (!model) return responses.notFound

    const folder = parameters.queries?.folder ?? ''
    const name = parameters.queries?.name
    if (!name) return responses.badRequest(`'name' query parameter is required.`)

    const controller = controllers[model] ?? controllers.documents
    if (!controller.delete) throw new Error('Document delete not implemented.')
    if (!(await controller.delete({ model, folder, name }, parameters))) return responses.notFound
    return responses.noContent
})

// Files

router.get(`/files/*`, async (parameters: Parameters) => {
    const name = decodeURI(parameters.parameters['*'] ?? '')
    if (!name) return responses.notFound

    const result = await parameters.environment.FILES.get(name)
    if (!result) return responses.notFound
    // @ts-ignore
    return new Response(result.body, { headers: { 'content-type': result.customMetadata?.content_type } })
})

export default {
    async fetch(request: Request, environment: Environment) {
        const url = new URL(request.url)
        const match = router.find(request.method as Methods, url.pathname)
        const [handler] = match.handlers as Endpoint[]
        if (handler)
            try {
                let body = request.body
                const headers = Object.fromEntries(request.headers.entries())
                if (headers['content-type'] === 'application/json') body = await request.json()

                let user: string | false = false
                const ip = headers['cf-connecting-ip'] ?? ''
                const session = parse(headers?.cookie ?? '')?.session
                const tokenPrefix = `Bearer `
                const token =
                    headers?.authorization && headers.authorization.startsWith(tokenPrefix)
                        ? headers.authorization.slice(tokenPrefix.length)
                        : undefined

                if (session)
                    user =
                        (await environment.DB.prepare(
                            'select sessions.email from sessions inner join users on users.email = sessions.email where sessions.key = ? and sessions.expires_at > ?'
                        )
                            .bind(`${session}${ip}`, time())
                            .first<string>('email')) ?? false
                else if (token)
                    user =
                        (await environment.DB.prepare('select email from users where key = ?').bind(token).first<string>('email')) ?? false

                return await handler({
                    request,
                    environment,
                    url,
                    headers,
                    queries: Object.fromEntries(Array.from(url.searchParams.entries()).map(([key, value]) => [key, decodeURI(value)])),
                    parameters: match.params,
                    body,
                    user,
                    ip,
                })
            } catch (e) {
                // TODO: Email/Slack error notification
                console.error(e)
                return new Response(undefined, { status: 500 })
            }

        return responses.notFound
    },
}
