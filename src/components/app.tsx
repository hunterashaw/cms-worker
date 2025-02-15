import React, { useState, useEffect, useCallback } from 'react'
import Login from './login'
import Documents from './documents'
import Editor, { ObjectSchema } from './editor'
import Header from './header'
import { EditorFieldsProps } from './editor-fields'

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export class Client {
    base: string
    headers: Record<string, string>
    email?: string
    unauthorized?: () => void

    constructor(base?: string, token?: string) {
        this.base = base ?? ''
        this.headers = {}
        if (token) this.headers.authorization = `Bearer ${token}`
    }

    async sendVerification(email: string) {
        const request = await fetch(`${this.base}verification`, {
            method: 'post',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                email,
            }),
        })
        if (request.ok) return true
        else return false
    }

    async createSession(email: string, verification: string) {
        const request = await fetch(`${this.base}session`, {
            method: 'post',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                email,
                verification,
            }),
        })
        if (request.ok) {
            this.email = email
            return true
        }
        return false
    }

    async getSession() {
        const request = await fetch(`${this.base}session`)
        if (request.ok) {
            const { email } = (await request.json()) as { email: string }
            this.email = email
            return true
        }
        return false
    }

    async deleteSession() {
        const request = await fetch(`${this.base}session`, { method: 'delete' })
        if (request.ok) {
            this.email = undefined
            return true
        }
        return false
    }

    async listFolders(model: string) {
        const request = await fetch(`${this.base}${model}/folders`, {
            headers: this.headers,
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('List folders failed.')
        }

        const results = (await request.json()) as string[]
        return results
    }

    async listDocuments(
        model: string,
        { folder, prefix, limit, after }: { folder?: string; prefix?: string; limit?: number; after?: string }
    ) {
        const params = new URLSearchParams()
        if (folder) params.append('folder', folder)
        if (prefix) params.append('prefix', prefix)
        if (limit) params.append('limit', limit.toString())
        if (after) params.append('after', after)

        const request = await fetch(`${this.base}${model}${params.size ? `?${params.toString()}` : ''}`, {
            headers: this.headers,
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('List documents failed.')
        }

        const results = (await request.json()) as {
            name: string
            folder: string
            modified_at: number
        }[]
        return { results, last: request.headers.get('x-last') }
    }

    async getDocument(model: string, folder: string, name: string) {
        const params = new URLSearchParams()
        if (folder) params.append('folder', folder)
        params.append('name', name)

        const request = await fetch(`${this.base}${model}?${params.toString()}`, { headers: this.headers })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Get documents failed.')
        }
        return request.json() as Promise<Record<string, any>>
    }

    async documentExists(model: string, folder: string, name: string) {
        const params = new URLSearchParams()
        if (folder) params.append('folder', folder)
        params.append('name', name)

        const request = await fetch(`${this.base}${model}?${params.toString()}`, { method: 'head', headers: this.headers })
        if (!request.ok) {
            if (request.status === 404) return false
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Document exists failed.')
        }
        return true
    }

    async upsertDocument({
        model,
        folder,
        name,
        value,
        newName,
        newFolder,
    }: {
        model: string
        folder: string
        name: string
        value: any
        newName?: string
        newFolder?: string
    }) {
        const params = new URLSearchParams()
        if (folder) params.append('folder', folder)
        params.append('name', name)
        if (name && newName && name !== newName) params.append('rename', newName)
        if (newFolder !== undefined && folder !== newFolder) params.append('move', newFolder)

        let request: Response
        if (value instanceof File) {
            request = await fetch(`${this.base}${model}?${params.toString()}`, {
                method: 'put',
                headers: { 'content-type': value.type || 'application/octet-stream', ...this.headers },
                body: value,
            })
        } else
            request = await fetch(`${this.base}${model}?${params.toString()}`, {
                method: 'put',
                headers: { 'content-type': 'application/json', ...this.headers },
                body: JSON.stringify(value),
            })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Upsert documents failed.')
        }
    }

    async deleteDocument(model: string, folder: string, name: string) {
        const params = new URLSearchParams()
        if (folder) params.append('folder', folder)
        params.append('name', name)

        const request = await fetch(`${this.base}${model}?${params.toString()}`, {
            method: 'delete',
            headers: this.headers,
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Delete documents failed.')
        }
    }
}

export const client = new Client()

export type Model = {
    /** Plural, lowercase name of model (example: 'products') */
    name: string
    /** Singular, lowercase name of model (example: 'product') */
    singularName: string
    /** Optional category annotation shown above model navigation */
    category?: string
    /** Optional model icon shown in navigation menu */
    icon?: React.JSX.Element
    /** JSON schema OR schema generator function */
    schema?: ObjectSchema | ((value: any) => ObjectSchema)
    /** Generate preview page URL for the document to be loaded in iframe. */
    previewURL?: (document: { model: string; name: string; value: any }) => string | undefined
    /** Optionally override editor fields */
    customEditor?: React.FC<EditorFieldsProps>
    /** JSON Schema $ref definitions for creating circular schema. */
    schemaReferences?: Record<string, ObjectSchema>
    /** Set as false to disable document retreival (for models like users & files) */
    allowGet?: boolean
    /** Set as false to disable document creation */
    allowCreate?: boolean
    /** Set as false to disable document folder creation */
    allowCreateFolder?: boolean
    /** Set as false to disable document updates */
    allowUpdate?: boolean
    /** Set as false to disable document renaming */
    allowRename?: boolean
    /** Set as false to disable document deletion */
    allowDelete?: boolean
    /** Set as false to disable document folders */
    allowFolders?: boolean
    /** Optional alias for the 'name' identifier */
    nameAlias?: string
    /** Optional alias for the 'folder' identifier */
    folderAlias?: string
    /** Optional plural alias for the 'folder' identifier */
    folderPluralAlias?: string
}

const initialParams = Object.fromEntries(new URLSearchParams(window.location.search).entries())

declare global {
    interface Window {
        cms: { name: string | undefined; folder: string | undefined; model: string }
    }
}

export default function App({ models }: { models: Model[] }) {
    const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined)
    const [model, setModel] = useState<string>(initialParams?.model ?? models[0]?.name ?? '')
    const [folder, setFolder] = useState<string>(initialParams?.folder ?? '')
    const [folders, setFolders] = useState<string[]>([])
    const [name, setName] = useState<string | undefined>(initialParams?.name)

    useEffect(() => {
        const params = new URLSearchParams()
        if (model) params.append('model', model)
        if (folder) params.append('folder', folder)
        if (name) params.append('name', name)
        window.history.pushState({ model, folder, name }, '', `${window.location.pathname}?${params.toString()}`)

        window.cms = { name, folder, model }
    }, [model, folder, name])

    useEffect(() => {
        client.getSession().then(value => {
            setAuthenticated(value)
            client.unauthorized = () => {
                setAuthenticated(false)
            }
        })

        const updateNavigation = (e: PopStateEvent) => {
            setModel(e.state?.model)
            setFolder(e.state?.folder)
            setName(e.state?.name)
        }
        window.addEventListener('popstate', updateNavigation)
        const keyboardShortcuts = (e: KeyboardEvent) => {
            // Within editor view
            if (window.cms.name !== undefined) {
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    e.preventDefault()
                    document.getElementById('document-back')?.click()
                    return
                } else if (e.metaKey) {
                    switch (e.key) {
                        case 'Enter':
                            e.stopPropagation()
                            e.preventDefault()
                            document.getElementById('save-document')?.click()
                            return
                    }
                }
            }
            // Within list view
            else {
                if (e.key === 'Escape') {
                    e.stopPropagation()
                    e.preventDefault()
                    document.getElementById('clear')?.click()
                    return
                } else if (e.metaKey) {
                    switch (e.key) {
                        case 'k':
                            e.stopPropagation()
                            e.preventDefault()
                            // @ts-ignore
                            document.getElementById('search')?.select()
                            return
                        case 'Enter':
                            e.stopPropagation()
                            e.preventDefault()
                            document.getElementById('new-document')?.click()
                            return
                    }
                }
            }
        }
        window.addEventListener('keydown', keyboardShortcuts)

        return () => {
            window.removeEventListener('popstate', updateNavigation)
            window.removeEventListener('keydown', keyboardShortcuts)
        }
    }, [])

    const fetchFolders = useCallback(async () => {
        if (models.find(({ name }) => name === model)?.allowFolders === false) return
        client.listFolders(model).then(setFolders)
    }, [model])

    useEffect(() => {
        if (authenticated && model && model !== 'users') fetchFolders()
        else setFolders([])
    }, [model, authenticated])

    return (
        <>
            {authenticated === false && <Login {...{ setAuthenticated }} />}
            {authenticated && (
                <div className="h-full min-h-screen grid grid-rows-[max-content,auto]">
                    <Header {...{ setAuthenticated }} />
                    {name === undefined ? (
                        <Documents {...{ model, setModel, folder, setFolder, folders, setName, models }} />
                    ) : (
                        <Editor {...{ model, setModel, folder, setFolder, folders, fetchFolders, name, setName, models }} />
                    )}
                </div>
            )}
        </>
    )
}
