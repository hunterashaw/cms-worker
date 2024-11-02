import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import clsx from 'clsx'
import { Model } from './app'
import { client } from './app'
import Header from './header'
import Reference from './reference'
import {
    LeftArrow,
    ServerIcon,
    DocumentCheckIcon,
    TrashIcon,
    UploadIcon,
    RightArrow,
    PlusIcon,
    CheckboxIcon
} from './icons'

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

type ArraySchema = {
    type: 'array'
    title?: string
    description?: string
    items: ArrayItemSchema | { anyOf: ArrayItemSchema[] }
}

function set(object: any, model: string[], value: any) {
    let current = object
    const last = model.pop() as string
    for (const piece of model) {
        if (current[piece] === undefined) {
            if (isNaN(Number(piece))) current[piece] = {}
            else current[piece] = []
        }
        current = current[piece]
    }
    current[last] = value
    return true
}

function nextID(value?: { _id: number }[]) {
    if (!value) return 1
    let current = 0
    for (const { _id } of value) if (_id > current) current = _id
    return current + 1
}

export default function Editor({
    setAuthenticated,
    model,
    name,
    setName,
    models
}: {
    setAuthenticated: (value: boolean) => void
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
                if (name !== newName && await client.documentExists(model, newName))
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

    const [editorModel, setEditorModel] = useState<string[]>([])
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
    useEffect(previewUpdate, [previewFrame, previewing])

    const { currentValue, currentSchema } = useMemo(() => {
        let currentValue
        let currentSchema: ObjectSchema | ArraySchema

        if (document && documentSchema) {
            currentValue = document
            currentSchema = documentSchema

            for (const piece of editorModel) {
                // @ts-ignore currentSchema is ObjectSchema
                if (isNaN(Number(piece))) currentSchema = currentSchema.properties[piece]
                else {
                    // @ts-ignore currentSchema is ArraySchema
                    if ((currentSchema as ArraySchema).items?.anyOf) {
                        const itemType = currentValue[piece]._type
                        // @ts-ignore currentSchema is ArraySchema
                        currentSchema = currentSchema.items.anyOf.find(item => item.title === itemType)
                        // @ts-ignore currentSchema is ArraySchema
                    } else currentSchema = currentSchema.items
                }

                if (currentValue[piece] === undefined) {
                    if (currentSchema.type === 'object') {
                        currentValue[piece] = {}
                    }
                    if (currentSchema.type === 'array') {
                        currentValue[piece] = []
                    }
                }
                currentValue = currentValue[piece]
            }
        }
        // @ts-ignore
        return { currentValue, currentSchema }
    }, [editorModel, document, documentSchema])

    return (
        <div className="h-full min-h-screen grid grid-rows-[max-content,auto]">
            <Header {...{ setAuthenticated }} />
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
                        <div className="flex gap-2 items-center">
                            <button
                                id="document-back"
                                onClick={() => {
                                    if (editorModel.length) {
                                        const last = editorModel.pop()
                                        if (!isNaN(Number(last))) editorModel.pop()
                                        setEditorModel([...editorModel])
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
                                className="w-72"
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
                            />
                        </div>
                        <span className="text-xs font-medium">{editorModel.join('.')}</span>
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
                        {currentValue && currentSchema && (
                            <div className="flex flex-col gap-4">
                                {currentSchema?.title && (
                                    <span className="ml-2 text-sm font-medium">{currentSchema.title}</span>
                                )}
                                {currentSchema?.title && (
                                    <span className="ml-2 text-sm text-neutral-500">{currentSchema.description}</span>
                                )}
                                {
                                    /* @ts-ignore */
                                    Object.keys(currentSchema?.properties ?? {}).map(key => {
                                        const id = `editor-field-${key}`

                                        const keyValue = currentValue[key]

                                        const keySchema = (currentSchema as ObjectSchema).properties[key]
                                        const title = keySchema?.title ?? key

                                        const update = newValue => {
                                            set(document, [...editorModel, key], newValue)
                                            setDocument({ ...document })
                                            setDocumentUpdated(true)
                                            previewUpdate()
                                        }

                                        if (keySchema.type === 'object')
                                            return (
                                                <div key={key}>
                                                    <button
                                                        title={keySchema?.description ?? key}
                                                        onClick={() => setEditorModel([...editorModel, key])}
                                                    >
                                                        <span>{title}</span>
                                                        <RightArrow />
                                                    </button>
                                                </div>
                                            )

                                        const input = (() => {
                                            if (keySchema.type === 'string') {
                                                if (keySchema.format === 'uri')
                                                    return (
                                                        <Reference
                                                            {...{ id, value: keyValue, schema: keySchema, update }}
                                                        />
                                                    )
                                                if (keySchema.format === 'date-time')
                                                    return (
                                                        <input
                                                            id={id}
                                                            type="datetime-local"
                                                            value={keyValue}
                                                            onChange={e => update(e.target.value as string)}
                                                        />
                                                    )
                                                if (keySchema.enum)
                                                    return (
                                                        <select
                                                            id={id}
                                                            value={keyValue}
                                                            onChange={e => update(e.target.value)}
                                                        >
                                                            <option className="text-neutral-500" value=""></option>
                                                            {keySchema.enum.map(option => (
                                                                <option key={option}>{option}</option>
                                                            ))}
                                                        </select>
                                                    )
                                                return (
                                                    <input
                                                        id={id}
                                                        value={keyValue}
                                                        onChange={e => update(e.target.value as string)}
                                                    />
                                                )
                                            }
                                            if (keySchema.type === 'number')
                                                return (
                                                    <input
                                                        type="number"
                                                        id={id}
                                                        value={keyValue as string}
                                                        onChange={e => update(Number(e.target.value))}
                                                    />
                                                )
                                            if (keySchema.type === 'boolean')
                                                return (
                                                    <label
                                                        htmlFor={id}
                                                        className={clsx(
                                                            'cursor-pointer flex w-9 h-9 justify-center items-center border border-neutral-300 rounded-md',
                                                            keyValue ? 'bg-blue-100' : 'bg-white'
                                                        )}
                                                    >
                                                        <CheckboxIcon />
                                                        <input
                                                            onChange={e => update(e.target.checked)}
                                                            checked={keyValue}
                                                            id={id}
                                                            className="hidden"
                                                            type="checkbox"
                                                        />
                                                    </label>
                                                )
                                            if (keySchema.type === 'array')
                                                return (
                                                    <div className="rounded-md flex flex-col border border-neutral-300">
                                                        {
                                                            /* @ts-ignore */
                                                            keySchema?.items?.anyOf &&
                                                                /* @ts-ignore */
                                                                keySchema.items.anyOf.map((item, i) => (
                                                                    <button
                                                                        key={i}
                                                                        className={clsx(
                                                                            'rounded-none border-0 first:rounded-t-md last:rounded-b-md bg-white border-b border-b-neutral-200 last:border-b-0',
                                                                            keyValue?.length && 'border-b'
                                                                        )}
                                                                        onClick={() => {
                                                                            update([
                                                                                ...(keyValue ?? []),
                                                                                {
                                                                                    // @ts-ignore
                                                                                    ...(item?.default ?? {}),
                                                                                    _id: nextID(keyValue),
                                                                                    // @ts-ignore
                                                                                    _type: item.title
                                                                                }
                                                                            ])
                                                                        }}
                                                                    >
                                                                        <PlusIcon />
                                                                        <span>{item?.title}</span>
                                                                        <span className="text-xs text-neutral-500">
                                                                            {item?.description}
                                                                        </span>
                                                                    </button>
                                                                ))
                                                        }
                                                        {
                                                            /* @ts-ignore */
                                                            keySchema?.items?.properties && (
                                                                <button
                                                                    className={clsx(
                                                                        'rounded-none border-0 first:rounded-t-md last:rounded-b-md bg-white border-b border-b-neutral-200 last:border-b-0',
                                                                        keyValue?.length && 'border-b'
                                                                    )}
                                                                    onClick={() => {
                                                                        update([
                                                                            ...(keyValue ?? []),
                                                                            {
                                                                                // @ts-ignore
                                                                                ...(keySchema?.items?.default ?? {}),
                                                                                _id: nextID(keyValue),
                                                                                // @ts-ignore
                                                                                _type: keySchema?.items?.title
                                                                            }
                                                                        ])
                                                                    }}
                                                                >
                                                                    <PlusIcon />
                                                                    <span>
                                                                        {
                                                                            /* @ts-ignore */
                                                                            keySchema?.items?.title
                                                                        }
                                                                    </span>
                                                                    <span className="text-xs text-neutral-500">
                                                                        {
                                                                            /* @ts-ignore */
                                                                            keySchema?.items?.description
                                                                        }
                                                                    </span>
                                                                </button>
                                                            )
                                                        }

                                                        {keyValue?.map((item, i) => (
                                                            <div
                                                                className="rounded-none border-b border-b-neutral-200 last:rounded-b-md last:border-b-0 grid grid-cols-[auto,max-content] p-0 group"
                                                                key={item._id}
                                                                draggable="true"
                                                                onDragStart={e => {
                                                                    e.dataTransfer.setData(
                                                                        'application/json',
                                                                        JSON.stringify({ key, i })
                                                                    )
                                                                    e.dataTransfer.effectAllowed = 'move'
                                                                }}
                                                                onDragEnter={e => {
                                                                    e.preventDefault()
                                                                }}
                                                                onDragOver={e => {
                                                                    e.preventDefault()
                                                                }}
                                                                onDrop={e => {
                                                                    try {
                                                                        const payload = JSON.parse(
                                                                            e.dataTransfer.getData('application/json')
                                                                        ) as { key: string; i: number }
                                                                        if (key !== payload.key)
                                                                            throw new Error('Cannot drop between keys.')
                                                                        if (payload.i === i) return
                                                                        const payloadValue = keyValue[payload.i]
                                                                        keyValue.splice(payload.i, 1)
                                                                        keyValue.splice(i, 0, payloadValue)
                                                                        update([...keyValue])
                                                                    } catch (e) {
                                                                        console.error(e)
                                                                    }
                                                                }}
                                                            >
                                                                <button
                                                                    className="border-0 rounded-none group-last:rounded-bl-md"
                                                                    onClick={() =>
                                                                        setEditorModel([
                                                                            ...editorModel,
                                                                            key,
                                                                            i.toString()
                                                                        ])
                                                                    }
                                                                >
                                                                    <span>
                                                                        {item._type} {item._id}
                                                                    </span>
                                                                    <RightArrow />
                                                                </button>
                                                                <div className="h-full">
                                                                    <button
                                                                        className="h-full rounded-none border-0 hover:bg-red-100 group-last:rounded-br-md"
                                                                        onClick={() => {
                                                                            // @ts-ignore
                                                                            keyValue.splice(i, 1)
                                                                            update([...keyValue])
                                                                        }}
                                                                    >
                                                                        <TrashIcon />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )
                                        })()

                                        return (
                                            <label
                                                key={key}
                                                htmlFor={id}
                                                className="flex flex-col gap-2 cursor-pointer"
                                            >
                                                <span className="flex gap-2 items-center">
                                                    <span className="text-sm font-medium ml-2">{title}</span>
                                                    <span className="text-xs text-neutral-500">
                                                        {keySchema?.description}
                                                    </span>
                                                </span>
                                                {input}
                                            </label>
                                        )
                                    })
                                }
                            </div>
                        )}
                    </div>
                </div>
                {previewing && previewURL && (
                    <iframe className="w-full h-full" ref={previewFrame} src={previewURL(document)}></iframe>
                )}
            </div>
        </div>
    )
}
