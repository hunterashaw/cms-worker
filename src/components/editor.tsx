import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import clsx from 'clsx'
import { Model } from './app'
import { client } from './app'
import { LeftArrow, ServerIcon, DocumentCheckIcon, TrashIcon, UploadIcon, RightArrow } from './icons'
import EditorFields from './editor-fields'

export type PropertySchema = ObjectSchema | StringSchema | ReferenceSchema | NumberSchema | BooleanSchema | ArraySchema

export type ObjectSchema = {
    type: 'object'
    title?: string
    description?: string
    properties: Record<string, PropertySchema>
}

type StringSchema = {
    type: 'string'
    title?: string
    description?: string
    format?: 'date-time'
    enum?: string[]
}

export type ReferenceSchema = {
    type: 'string'
    title?: string
    description?: string
    format: 'uri'
    model: 'files' | 'users' | string
    enum?: string[]
}

type NumberSchema = {
    type: 'number'
    title?: string
    description?: string
}

type BooleanSchema = {
    type: 'boolean'
    title?: string
    description?: string
}

type ArrayItemSchema = {
    type: 'object'
    title: string
    description?: string
    properties: Record<string, PropertySchema>
    default: any
}

export type ArraySchema = {
    type: 'array'
    title?: string
    description?: string
    items: ArrayItemSchema | { anyOf: ArrayItemSchema[] }
}

export default function Editor({
    model,
    name,
    setName,
    models
}: {
    model: string
    name: string
    setName: (value: string | undefined) => void
    models: Model[]
}) {
    const [loading, setLoading] = useState(false)
    const [document, setDocument] = useState<any>({})
    const [documentUpdated, setDocumentUpdated] = useState(false)
    const [newName, setNewName] = useState<string | undefined>(name)
    const leaveEditor = useCallback(() => {
        if (!documentUpdated) setName(undefined)
        else if (window.confirm('Discard changes?')) setName(undefined)
    }, [setName, documentUpdated])
    const { isUsers, isFiles } = useMemo(() => ({ isUsers: model === 'users', isFiles: model === 'files' }), [model])

    const fetchDocument = useCallback(() => {
        if (!name || isUsers || isFiles) return
        setLoading(true)
        client.getDocument(model, name).then(({ value }) => {
            setDocument(value)
            setDocumentUpdated(false)
            setLoading(false)
        })
    }, [setLoading, setDocument, name, model, isUsers, isFiles])
    useEffect(() => {
        fetchDocument()
        // @ts-ignore
        if (name === '') window.document.getElementById('document-name')?.focus()
    }, [])
    const saveDocument = useCallback(async () => {
        if (!newName) return alert('Document name is required.')
        setLoading(true)
        try {
            const updateName = name && name !== newName

            if (isFiles) {
                if (await client.fileExists(newName))
                    if (!confirm('File already exists, overwrite?')) return setLoading(false)
                const file = (window.document.getElementById('file') as HTMLInputElement)?.files?.item(0)
                if (!file) return alert('File is required.')
                if (updateName) await client.deleteFile(name)
                await client.upsertFile(newName, file)
            } else if (isUsers) {
                if (updateName) await client.deleteUser(name)
                await client.createUser(name || newName)
            } else {
                if (name !== newName && (await client.documentExists(model, newName)))
                    if (!confirm('Document already exists, overwrite?')) return setLoading(false)
                await client.upsertDocument(model, name || newName, document, newName)
            }

            setDocumentUpdated(false)
            setName(newName)
        } catch (e) {
            alert('Failed to save document.')
            console.error(e)
        }
        setLoading(false)
    }, [document, setDocumentUpdated, setLoading, name, setName, newName, isFiles, isUsers])
    const deleteDocument = useCallback(async () => {
        if (!window.confirm('Delete document?')) return
        setLoading(true)
        try {
            if (isUsers) await client.deleteUser(name)
            else if (isFiles) await client.deleteFile(name)
            else await client.deleteDocument(model, name)
            setName(undefined)
        } catch (e) {
            alert('Failed to delete document.')
            console.error(e)
        }
        setLoading(false)
    }, [model, name, setLoading, isUsers, isFiles])

    const [path, setPath] = useState<string[]>([])
    const { documentSchema, previewURL } = useMemo(() => {
        const nameMatch = models.find(
            configurationModel => configurationModel.name === model && configurationModel.key === name
        )
        if (nameMatch) return { documentSchema: nameMatch.schema, previewURL: nameMatch.previewURL }
        const modelMatch = models.find(({ name }) => name === model)
        return { documentSchema: modelMatch?.schema, previewURL: modelMatch?.previewURL }
    }, [model, name])
    const [previewing, setPreviewing] = useState(false)
    const previewFrame = useRef(null)

    const previewUpdate = useDebouncedCallback(
        useCallback(() => {
            if (previewFrame.current)
                // @ts-ignore
                previewFrame.current.contentWindow.postMessage({ model, name: newName, document })
        }, [previewFrame, model, newName, document]),
        125
    )
    useEffect(previewUpdate, [previewFrame, previewing, document])

    return (
        <div className="grid grid-cols-[max-content,auto] min-h-full">
            {!previewing && (
                <div className="p-4 flex flex-col gap-2">
                    <button className="w-max" onClick={leaveEditor}>
                        <LeftArrow />
                        <span>{model}</span>
                    </button>
                </div>
            )}
            <div
                className={clsx(
                    'p-4 flex justify-center',
                    previewing && 'w-99 max-w-full border-r border-r-neutral-300'
                )}
            >
                <div className="w-full max-w-xl flex flex-col gap-4">
                    <div className="grid grid-cols-[auto,max-content] h-10">
                        <h1 className="pl-2 text-lg font-medium flex items-center gap-2">
                            {model || '/'}
                            {loading && <span className="text-neutral-500 text-sm font-medium">loading...</span>}
                        </h1>
                        <div className="flex gap-2">
                            {name && (
                                <button onClick={deleteDocument}>
                                    <span>delete</span>
                                    <TrashIcon />
                                </button>
                            )}
                            {previewURL && (
                                <button
                                    onClick={() => {
                                        setPreviewing(!previewing)
                                    }}
                                >
                                    <span>{previewing && 'end'} preview</span>
                                    {previewing && <RightArrow />}
                                    {!previewing && <DocumentCheckIcon />}
                                </button>
                            )}
                            {documentUpdated && (
                                <button id="save-document" disabled={loading} onClick={saveDocument}>
                                    <span>save</span>
                                    <ServerIcon />
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="grid grid-cols-[min-content,auto] gap-2 items-center">
                        <button
                            id="document-back"
                            onClick={() => {
                                if (path.length) {
                                    const last = path.pop()
                                    if (!isNaN(Number(last))) path.pop()
                                    setPath([...path])
                                    return
                                }
                                leaveEditor()
                            }}
                        >
                            <LeftArrow />
                            <span>back</span>
                        </button>
                        <input
                            id="document-name"
                            value={newName}
                            onChange={e => {
                                if (e.target.value !== newName) {
                                    setNewName(e.target.value)
                                    setDocumentUpdated(true)
                                    previewUpdate()
                                }
                            }}
                            placeholder={`new ${isUsers ? 'user email' : 'document name'}`}
                            required
                            title='Document name'
                        />
                    </div>
                    <span className="text-xs font-medium">{path.join('.')}</span>
                    {isFiles && (
                        <>
                            <label htmlFor="file" className="flex flex-col gap-2 cursor-pointer">
                                <span className="flex gap-2 items-center">
                                    <span className="text-sm font-medium ml-2">file</span>
                                </span>
                                <input
                                    id="file"
                                    className="hidden"
                                    type="file"
                                    onChange={e => {
                                        const file = e.target.files?.item(0)
                                        if (file) setNewName(file.name)
                                        setDocumentUpdated(true)
                                    }}
                                />
                                <label className="button cursor-pointer w-max" htmlFor="file" role="button">
                                    <span>upload</span>
                                    <UploadIcon />
                                </label>
                            </label>
                            {name && (
                                <img
                                    src={`/file/${name}`}
                                    className="w-max max-w-full h-auto"
                                    onError={e => {
                                        // @ts-ignore
                                        e.target.style.display = 'none'
                                    }}
                                />
                            )}
                        </>
                    )}
                    {documentSchema && (
                        <EditorFields
                            {...{ path, setPath, document, setDocument, setDocumentUpdated, documentSchema }}
                        />
                    )}
                </div>
            </div>
            {previewing && previewURL && (
                <iframe className="w-full h-full" ref={previewFrame} src={previewURL(document)}></iframe>
            )}
        </div>
    )
}
