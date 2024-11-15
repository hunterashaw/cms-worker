import { ModelController, time } from './worker'

export const modelController: ModelController = {
    async list({ prefix, limit, after }, { parameters, environment: { DB } }) {
        const model = parameters?.model ?? ''

        if (prefix)
            return (
                await DB.prepare(
                    'select rowid as id, name, modified_at from documents where model = ? and name glob ? and rowid > ? order by name, rowid limit ?'
                )
                    .bind(model, `${prefix}*`, after, limit)
                    .all<{ id: number; name: string; modified_at: number }>()
            ).results
        else
            return (
                await DB.prepare(
                    'select rowid as id, name, modified_at from documents where model = ? and rowid > ? order by modified_at, rowid limit ?'
                )
                    .bind(model, after, limit)
                    .all<{ id: number; name: string; modified_at: number }>()
            ).results
    },
    async exists(name, { parameters, environment: { DB } }) {
        const model = parameters?.model ?? ''

        return Boolean(
            await DB.prepare('select created_at from documents where model = ? and name = ?')
                .bind(model, name)
                .first<{ created_at: number }>()
        )
    },
    async get(name, { parameters, environment: { DB } }) {
        const model = parameters?.model ?? ''

        return await DB.prepare('select value, modified_at from documents where model = ? and name = ?')
            .bind(model, name)
            .first<{ value: string; modified_at: number }>()
    },
    async put({ name, value, modified_by }, { parameters, queries, environment: { DB } }) {
        const model = parameters?.model ?? ''

        const existing = await DB.prepare('select rowid from documents where model = ? and name = ?')
            .bind(model, name)
            .first<number>('rowid')

        const rename = queries?.rename
        if (rename && !existing) throw new Error('Cannot rename non-existant document.')
        const now = time()

        if (existing)
            await DB.prepare(
                'update documents set name = ?, value = ?, modified_at = ?, modified_by = ? where rowid = ?'
            )
                .bind(rename ?? name, JSON.stringify(value), now, modified_by, existing)
                .run()
        else
            await DB.prepare(
                'insert into documents (model, name, value, created_at, modified_at, modified_by) values (?, ?, ?, ?, ?, ?)'
            )
                .bind(model, name, JSON.stringify(value), now, now, modified_by)
                .run()
    },
    async delete(name, { parameters, environment: { DB } }) {
        const model = parameters?.model ?? ''

        const existing = await DB.prepare('select rowid from documents where model = ? and name = ?')
            .bind(model, name)
            .first<number>('rowid')
        await DB.prepare('delete from documents where rowid = ?').bind(existing).run()
    }
}
