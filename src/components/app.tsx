import React, { useState, useEffect } from 'react'
import Login from './login'
import Documents from './documents'
import Editor, { ObjectSchema } from './editor'
import Header from './header'

export class Client {
    headers: Record<string, string>
    email?: string
    unauthorized?: () => void

    constructor(token?: string) {
        this.headers = {}
        if (token) this.headers.authorization = `Bearer ${token}`
    }

    async sendVerification(email: string) {
        const request = await fetch('/verification', {
            method: 'post',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                email
            })
        })
        if (request.ok) return true
        else return false
    }

    async createSession(email: string, verification: string) {
        const request = await fetch('/session', {
            method: 'post',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                email,
                verification
            })
        })
        if (request.ok) {
            this.email = email
            return true
        }
        return false
    }

    async getSession() {
        const request = await fetch('/session')
        if (request.ok) {
            const { email } = (await request.json()) as { email: string }
            this.email = email
            return true
        }
        return false
    }

    async deleteSession() {
        const request = await fetch('/session', { method: 'delete' })
        if (request.ok) {
            this.email = undefined
            return true
        }
        return false
    }

    async listDocuments(model: string, { prefix, limit, after }: { prefix?: string; limit?: number; after?: string }) {
        const params = new URLSearchParams()
        if (prefix) params.append('prefix', prefix)
        if (limit) params.append('limit', limit.toString())
        if (after) params.append('after', after)

        const request = await fetch(`/documents/${model}${params.size ? `?${params.toString()}` : ''}`, {
            headers: this.headers
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('List documents failed.')
        }

        const results = (await request.json()) as {
            name: string
            created_at: number
            modified_at: number
            modified_by: string
        }[]
        return { results, last: request.headers.get('x-last') }
    }

    async getDocument(model: string, name: string) {
        const request = await fetch(`/document/${model}/${name}`, { headers: this.headers })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Get documents failed.')
        }
        return request.json() as Promise<{ value: any; created_at: number; modified_at: number; modified_by: string }>
    }

    async documentExists(model: string, name: string) {
        const request = await fetch(`/document/${model}/${name}`, { method: 'head', headers: this.headers })
        if (!request.ok) {
            if (request.status === 404) return false
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Document exists failed.')
        }
        return true
    }

    async upsertDocument(model: string, name: string, value: any, newName?: string) {
        const params = new URLSearchParams()
        if (name && newName && name !== newName) params.append('rename', newName)

        const request = await fetch(
            `/document/${model}/${name ?? newName}${params.size ? `?${params.toString()}` : ''}`,
            {
                method: 'put',
                headers: { 'content-type': 'application/json', ...this.headers },
                body: JSON.stringify(value)
            }
        )
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Upsert documents failed.')
        }
    }

    async deleteDocument(model: string, name: string) {
        const request = await fetch(`/document/${model}/${name}`, {
            method: 'delete',
            headers: this.headers
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Delete documents failed.')
        }
    }

    async listFiles({ prefix, limit, after }: { prefix?: string; limit?: number; after?: string }) {
        const params = new URLSearchParams()
        if (prefix) params.append('prefix', prefix)
        if (limit) params.append('limit', limit.toString())
        if (after) params.append('after', after)

        const request = await fetch(`/files/${params.size ? `?${params.toString()}` : ''}`, { headers: this.headers })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('List files failed.')
        }
        const results = (await request.json()) as {
            name: string
            created_at: number
            modified_at: number
            modified_by: string
        }[]
        return { results, last: request.headers.get('x-last') }
    }

    async getFile(key: string) {
        const request = await fetch(`/file/${key}`, { headers: this.headers })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Get file failed.')
        }
        return request.blob()
    }

    async fileExists(key: string) {
        const request = await fetch(`/file/${key}`, { method: 'head', headers: this.headers })
        if (!request.ok) {
            if (request.status === 404) return false
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('File exists failed.')
        }
        return true
    }

    async upsertFile(key: string, file: File) {
        const request = await fetch(`/file/${key}`, {
            method: 'put',
            headers: { 'content-type': file.type || 'application/octet-stream', ...this.headers },
            body: file
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Upsert file failed.')
        }
    }

    async deleteFile(key: string) {
        const request = await fetch(`/file/${key}`, {
            method: 'delete',
            headers: this.headers
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Delete file failed.')
        }
    }

    async listUsers(prefix?: string) {
        const params = new URLSearchParams()
        if (prefix) params.append('prefix', prefix)

        const request = await fetch(`/users/${params.size ? `?${params.toString()}` : ''}`, { headers: this.headers })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('List files failed.')
        }
        return request.json() as Promise<{ email: string }[]>
    }

    async createUser(email: string) {
        const request = await fetch(`/user/`, {
            method: 'post',
            headers: { 'content-type': 'application/json', ...this.headers },
            body: JSON.stringify({ email })
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Create user failed.')
        }
    }

    async deleteUser(email: string) {
        const params = new URLSearchParams()
        params.append('email', email)
        const request = await fetch(`/user/?${params}`, {
            method: 'delete',
            headers: this.headers
        })
        if (!request.ok) {
            if (request.status === 401 && this.unauthorized) this.unauthorized()
            throw new Error('Create user failed.')
        }
    }
}

export const client = new Client()

export type Model = {
    name: string
    key?: string
    schema: ObjectSchema
    previewURL?: (document: { model: string; name: string; value: any }) => string | undefined
}

const initialParams = Object.fromEntries(new URLSearchParams(window.location.search).entries())

declare global {
    interface Window {
        cms: { name: string | undefined; model: string }
    }
}

export default function App({ models }: { models: Model[] }) {
    const [authenticated, setAuthenticated] = useState<boolean | undefined>(undefined)
    const [model, setModel] = useState<string>(initialParams?.model ?? models[0]?.name ?? '')
    const [name, setName] = useState<string | undefined>(initialParams?.name)

    useEffect(() => {
        const params = new URLSearchParams()
        if (model) params.append('model', model)
        if (name) params.append('name', name)
        window.history.pushState({ model, name }, '', `${window.location.pathname}?${params.toString()}`)

        window.cms = { name, model }
    }, [model, name])

    useEffect(() => {
        if (models.some(model => ['users', 'files'].includes(model.name)))
            alert('Models cannot contain "users" or "files" models (these are used internally).')
        client.getSession().then(value => {
            setAuthenticated(value)
            client.unauthorized = () => {
                setAuthenticated(false)
            }
        })

        const updateNavigation = (e: PopStateEvent) => {
            setModel(e.state?.model)
            setName(e.state?.name)
        }
        window.addEventListener('popstate', updateNavigation)
        const keyboardShortcuts = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && window.cms.name) {
                e.stopPropagation()
                e.preventDefault()
                document.getElementById('document-back')?.click()
                return
            }
            if (e.metaKey) {
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
                        if (window.cms.name === undefined) document.getElementById('new-document')?.click()
                        else document.getElementById('save-document')?.click()
                        return
                }
            }
        }
        window.addEventListener('keydown', keyboardShortcuts)

        return () => {
            window.removeEventListener('popstate', updateNavigation)
            window.removeEventListener('keydown', keyboardShortcuts)
        }
    }, [])

    return (
        <>
            {authenticated === false && <Login {...{ setAuthenticated }} />}
            {authenticated && (
                <div className="h-full min-h-screen grid grid-rows-[max-content,auto]">
                    <Header {...{ setAuthenticated }} />
                    {name === undefined ? (
                        <Documents {...{ model, setModel, setName, models }} />
                    ) : (
                        <Editor {...{ model, name, setName, models }} />
                    )}
                </div>
            )}
        </>
    )
}
