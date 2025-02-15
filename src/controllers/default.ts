import { D1Database } from '@cloudflare/workers-types/experimental'
import { Controller, time } from '../worker'

export function queryPrefix(prefix: string, name = 'name') {
    const query = [`${name} like ?`]
    const bindings = [`${prefix}%`]
    const addBinding = prefix => {
        query.push(`${name} like ?`)
        bindings.push(prefix)
    }

    for (let i = prefix.length - 1; i >= 0; i--) {
        const copy = prefix.split('')
        copy[i] = '%'

        if (i === prefix.length - 1) {
            if (prefix.length > 1) {
                addBinding(`${copy.join('')}`)
            }
        } else {
            addBinding(`${copy.join('')}%`)
        }
    }
    addBinding(`%${prefix}%`)

    return { query: query.join(' or '), bindings }
}

const cache = {
    async get({ key, DB }: { key: string; DB: D1Database }): Promise<any | void> {
        const cached = await DB.prepare('select value from cache where key = ?').bind(key).first<string>('value')
        if (cached) return JSON.parse(cached)
    },
    async put({ key, value, DB }: { key: string; value: any; DB: D1Database }) {
        const existing = await DB.prepare('select rowid from cache where key = ?').bind(key).first<number>('rowid')
        if (existing) return (await DB.prepare('update cache set value = ? where key = ?').bind(JSON.stringify(value), key).run()).success
        else return (await DB.prepare('insert into cache (key, value) values (?, ?)').bind(key, JSON.stringify(value)).run()).success
    },
    async delete({ key, DB }: { key: string; DB: D1Database }) {
        return (await DB.prepare('delete from cache where key = ?').bind(key).run()).success
    },
}

export const documentsController: Controller = {
    async list({ model, folder, prefix, limit, after }, { environment: { DB } }) {
        const prefixQuery = prefix ? queryPrefix(prefix) : undefined
        const { results } = await DB.prepare(
            `select rowid, folder, name, modified_at from documents where model = ?${folder ? ' and folder = ?' : ''}${
                prefixQuery ? ` and (${prefixQuery.query})` : ''
            } and rowid > ? order by name, rowid limit ?`
        )
            .bind(
                ...[model, folder, ...(prefixQuery ? prefixQuery.bindings : []), after || 0, limit].filter(
                    parameter => parameter !== undefined
                )
            )
            .all<{
                rowid: number
                folder: string
                name: string
                modified_at: number
            }>()

        return {
            results,
            last: results.length === limit ? results[results.length - 1]?.rowid?.toString() : undefined,
        }
    },
    async listFolders({ model }, { environment: { DB } }) {
        const cached = await cache.get({ key: `${model}-folders`, DB })
        if (cached) cached

        const folders = (
            await DB.prepare('select distinct folder from documents where model = ?').bind(model).all<{ folder: string }>()
        ).results
            .map(({ folder }) => folder)
            .filter(folder => folder)
        await cache.put({ key: `${model}-folders`, value: folders, DB })
        return folders
    },
    async exists({ model, folder, name }, { environment: { DB } }) {
        return Boolean(
            await DB.prepare('select rowid from documents where model = ? and folder = ? and name = ?')
                .bind(model, folder, name)
                .first<{ rowid: number }>()
        )
    },
    async get({ model, folder, name }, { environment: { DB } }) {
        const result = await DB.prepare('select value, modified_at from documents where model = ? and folder = ? and name = ?')
            .bind(model, folder, name)
            .first<{ value: string; modified_at: number }>()
        if (!result) return

        const value = {
            ...JSON.parse(result.value),
            _modified_at: result.modified_at,
            _model: model,
            _folder: folder,
            _name: name,
        }
        return value
    },
    async put({ model, folder, name, rename, move, value, modified_by }, { environment: { DB } }) {
        let existing = await DB.prepare('select rowid, folder from documents where model = ? and folder = ? and name = ?')
            .bind(model, folder, name)
            .first<{ rowid: number; folder: string }>()
        if (rename && !existing) throw new Error('Cannot rename non-existant document.')

        const now = time()
        const serializedValue = JSON.stringify({
            ...value,
            _modified_at: now,
            _model: model,
            _folder: folder,
            _name: name,
        })

        if (move !== undefined) await cache.delete({ key: `${model}-folders`, DB })

        if (existing && move && existing.folder !== move) {
            await DB.prepare('delete from documents where model = ? and folder = ? and name = ?').bind(model, folder, name).run()
            existing = null
        }

        if (existing) {
            return (
                await DB.prepare('update documents set folder = ?, name = ?, value = ?, modified_at = ?, modified_by = ? where rowid = ?')
                    .bind(move ?? folder, rename ?? name, serializedValue, now, modified_by, existing.rowid)
                    .run()
            ).success
        } else {
            return (
                await DB.prepare('insert into documents (model, folder, name, value, modified_at, modified_by) values (?, ?, ?, ?, ?, ?)')
                    .bind(model, move ?? folder, name, serializedValue, now, modified_by)
                    .run()
            ).success
        }
    },
    async delete({ model, folder, name }, { environment: { DB } }) {
        return (await DB.prepare('delete from documents where model = ? and folder = ? and name = ?').bind(model, folder, name).run())
            .success
    },
}

export const filesController: Controller = {
    async list({ folder, prefix, limit, after }, { environment: { FILES } }) {
        const results = await FILES.list({
            prefix: `${folder ? `${folder}/` : ''}${prefix ?? ''}`,
            limit,
            cursor: after,
            include: ['customMetadata'],
        })

        return {
            results: results.objects.map(object => {
                const pieces = object.key.split('/')
                const modified_at = Math.floor(object.uploaded.getTime() / 1000)

                if (pieces.length === 2)
                    return {
                        name: pieces[1],
                        folder: pieces[0],
                        modified_at,
                    }

                return {
                    name: object.key,
                    modified_at,
                }
            }),
            // @ts-ignore
            last: results?.cursor,
        }
    },
    async listFolders({ model }, { environment: { DB } }) {
        const cached = (await cache.get({ key: `${model}-folders`, DB })) as string[] | undefined
        if (cached) return cached
        return []
    },
    async exists({ name, folder }, { environment: { FILES } }) {
        return Boolean(await FILES.head(`${folder ? `${folder}/` : ''}${name}`))
    },
    async get({ name, folder }, { environment: { FILES } }) {
        const result = await FILES.get(`${folder ? `${folder}/` : ''}${name}`)
        if (!result) return
        // @ts-ignore
        return new Response(result.body, { headers: { 'content-type': result.customMetadata?.content_type } })
    },
    async put({ model, name, folder, rename, move }, { headers, request, environment: { DB, FILES } }) {
        if (rename || move !== undefined) await FILES.delete(`${folder ? `${folder}/` : ''}${name}`)

        if (move) {
            // Update cached folders if needed
            const folders = (await cache.get({ key: `${model}-folders`, DB })) ?? []

            if (!folders.includes(move)) {
                folders.push(move)
                await cache.put({ key: `${model}-folders`, value: folders, DB })
            }
        }

        // @ts-ignore
        await FILES.put(`${move ?? folder ? `${move ?? folder}/` : ''}${rename ?? name}`, request.body, {
            customMetadata: { content_type: headers['content-type'] },
        })
        return true
    },
    async delete({ name, folder }, { environment: { FILES } }) {
        await FILES.delete(`${folder ? `${folder}/` : ''}${name}`)
        return true
    },
}

export const usersController: Controller = {
    async list({ prefix }, { environment: { DB } }) {
        const prefixQuery = prefix ? queryPrefix(prefix, 'email') : undefined
        const { results } = await DB.prepare(`select email from users ${prefixQuery ? `where (${prefixQuery.query})` : ''} order by email`)
            .bind(...[...(prefixQuery ? prefixQuery.bindings : [])].filter(parameter => parameter !== undefined))
            .all<{
                email: string
            }>()

        return {
            results: results.map(({ email }) => ({ name: email })),
        }
    },
    async exists({ name }, { environment: { DB } }) {
        const existing = await DB.prepare('select email from users where email = ?').bind(name).first('email')
        return Boolean(existing)
    },
    async put({ name }, { environment: { DB } }) {
        const existing = await DB.prepare('select email from users where email = ?').bind(name).first<string>('email')
        if (existing) return false
        return (await DB.prepare('insert into users (email, key) values (?, ?)').bind(name, crypto.randomUUID()).run()).success
    },
    async delete({ name }, { environment: { DB } }) {
        return (await DB.prepare('delete from users where email = ?').bind(name).run()).success
    },
}
