import { ModelController, time } from '../worker'

export const defaultController: ModelController = {
    async list({ path, prefix, limit, after }, { environment: { DB } }) {
        const documents = prefix
            ? (
                  await DB.prepare(
                      'select rowid, name, modified_at from documents where path = ? and name glob ? and rowid > ? order by name, rowid limit ?'
                  )
                      .bind(path, `${prefix}*`, after, limit)
                      .all<{ rowid: number; name: string; modified_at: number }>()
              ).results
            : (
                  await DB.prepare(
                      'select rowid, name, modified_at from documents where path = ? and rowid > ? order by modified_at, rowid limit ?'
                  )
                      .bind(path, after, limit)
                      .all<{ rowid: number; name: string; modified_at: number }>()
              ).results

        const folders = prefix
            ? (
                  await DB.prepare('select name from folders where path = ? and name glob ? order by name')
                      .bind(path, `${prefix}*`)
                      .all<{ name: string }>()
              ).results
            : (await DB.prepare('select name from folders where path = ? order by name').bind(path).all<{ name: string }>()).results

        return { documents, folders, last: documents.length ? documents[documents.length - 1]?.rowid?.toString() : undefined }
    },
    async exists({ path, name }, { environment: { DB } }) {
        return Boolean(
            await DB.prepare('select rowid from documents where path = ? and name = ?').bind(path, name).first<{ rowid: number }>()
        )
    },
    async get({ path, name }, { environment: { DB } }) {
        const result = await DB.prepare('select value, blob from documents where path = ? and name = ?')
            .bind(path, name)
            .first<{ value: string; blob: ArrayBuffer }>()
        if (!result) return
        return {
            value: JSON.parse(result.value),
            blob: result.blob,
        }
    },
    async put({ path, name, rename, value, blob }, { user, environment: { DB } }) {
        if (!name) {
            const existing = await DB.prepare('select rowid from folders where path = ? and name = ?')
                .bind(path, name)
                .first<number>('rowid')

            if (existing)
                await DB.prepare('update folders set name = ? where rowid = ?')
                    .bind(rename ?? name, existing)
                    .run()
            else await DB.prepare('insert into folders (path, name) values (?, ?)').bind(path, name).run()
            return
        }

        const existing = await DB.prepare('select rowid from documents where path = ? and name = ?').bind(path, name).first<number>('rowid')
        if (rename && !existing) throw new Error('Cannot rename non-existant document.')
        const now = time()

        if (existing)
            await DB.prepare('update documents set name = ?, value = ?, blob = ?, modified_at = ?, modified_by = ? where rowid = ?')
                .bind(rename ?? name, JSON.stringify(value), blob ?? null, now, user, existing)
                .run()
        else
            await DB.prepare(
                'insert into documents (model, name, value, blob, created_at, modified_at, modified_by) values (?, ?, ?, ?, ?, ?, ?)'
            )
                .bind(path, name, JSON.stringify(value), blob ?? null, now, now, user)
                .run()
    },
    async delete({ path, name }, { environment: { DB } }) {
        const existing = await DB.prepare('select rowid from documents where path = ? and name = ?').bind(path, name).first<number>('rowid')
        await DB.prepare('delete from documents where rowid = ?').bind(existing).run()
    },
}
