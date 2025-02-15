import App, { Model } from './components/app'
import { createRoot } from 'react-dom/client'
import React, { useEffect, useMemo, useState } from 'react'
import { models as customModels } from './config'
import { AttachmentIcon, DuplicateIcon, UploadIcon, UserIcon } from './components/icons'

window.addEventListener('DOMContentLoaded', () => {
    const models = [...customModels]
    if (models[0]) models[0].category = 'content'

    models.push({
        name: 'files',
        singularName: 'file',
        category: 'system',
        icon: <AttachmentIcon />,
        customEditor: ({ folder, name, setNewName, document, setDocument, documentUpdated, setDocumentUpdated }) => {
            const [previewURL, setPreviewURL] = useState('')
            const [copied, setCopied] = useState(false)
            const externalURL = useMemo(() => {
                const url = new URL(window.location.href)
                url.pathname = `/files/${folder ? `${folder}/` : ''}${name}`
                url.search = ''
                return url.toString()
            }, [name, folder])

            useEffect(() => {
                if (name) {
                    fetch(externalURL).then(request => {
                        if (!request.ok) return
                        request.blob().then(blob => {
                            setDocument(
                                new File([blob], name, {
                                    type: request.headers.get('content-type') ?? undefined,
                                })
                            )
                        })
                    })
                }
            }, [name, folder])

            useEffect(() => {
                if (document instanceof File && document.type.startsWith('image/')) {
                    const reader = new FileReader()
                    reader.onload = e => setPreviewURL(e.target?.result as string)
                    reader.readAsDataURL(document)
                }
            }, [document])

            return (
                <>
                    <div className="flex gap-4 w-full">
                        <label
                            htmlFor={'file-input'}
                            className={'button'}
                            onChange={e => {
                                // @ts-ignore
                                const file = e.target.files?.item(0) as File | undefined
                                if (!file) return
                                setDocument(file)
                                setNewName(file.name)
                                setDocumentUpdated(true)
                            }}
                        >
                            <span>{document ? 'replace' : 'upload'}</span>
                            <UploadIcon />
                            <input type="file" id="file-input" className="hidden" />
                        </label>
                        {!documentUpdated && name && (
                            <button
                                disabled={copied}
                                onClick={e => {
                                    navigator.clipboard.writeText(externalURL)
                                    setCopied(true)
                                    setTimeout(() => setCopied(false), 3000)
                                }}
                            >
                                <span>{copied ? 'copied' : 'copy url'}</span>
                                <DuplicateIcon />
                            </button>
                        )}
                    </div>

                    {previewURL && (
                        <div className="flex flex-col gap-2 cursor-pointer w-full">
                            <label htmlFor="file-preview" className="text-sm font-medium ml-2">
                                image preview
                            </label>
                            <a href={externalURL} target="_blank">
                                <img
                                    id="file-preview"
                                    src={previewURL}
                                    className="w-max max-w-full h-auto"
                                    onError={e => {
                                        setPreviewURL('')
                                    }}
                                />
                            </a>
                        </div>
                    )}
                </>
            )
        },
        allowGet: false,
    })

    models.push({
        name: 'users',
        singularName: 'user',
        icon: <UserIcon />,
        schema: { type: 'object', properties: {}, description: 'Add user by email.' },
        allowGet: false,
        allowRename: false,
        allowFolders: false,
        allowUpdate: false,
        nameAlias: 'email',
    })

    const root = document.getElementById('root')
    if (!root) throw new Error('App root not found')
    createRoot(root).render(<App {...{ models }} />)
})
