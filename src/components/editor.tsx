import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useDebouncedCallback } from 'use-debounce'
import clsx from 'clsx'
import { Model } from './app'
import { client } from './app'
import { LeftArrow, ServerIcon, DocumentCheckIcon, TrashIcon, FolderIcon, FileIcon, DuplicateIcon } from './icons'
import EditorFields from './editor-fields'
import { vars as environment } from '../../wrangler.json'

const DEMO = environment.DEMO

export type PropertySchema = ObjectSchema | StringSchema | NumberSchema | BooleanSchema | ArraySchema

export type ReferenceSchema = {
    $ref: string
}

export type ObjectSchema = {
    type: 'object'
    title?: string
    description?: string
    properties: Record<string, ReferenceSchema | PropertySchema>
    default?: any
}

export type StringSchema = {
    type: 'string'
    title?: string
    description?: string
    format?: 'date-time' | 'markdown'
    enum?: string[]
    default?: string
}

export type NumberSchema = {
    type: 'number'
    title?: string
    description?: string
    default?: number
}

export type BooleanSchema = {
    type: 'boolean'
    title?: string
    description?: string
    default?: boolean
}

export type ArrayItemSchema =
    | ReferenceSchema
    | {
          type: 'object'
          title: string
          description?: string
          properties: Record<string, PropertySchema>
          default?: any
      }

export type ArraySchema = {
    type: 'array'
    title?: string
    description?: string
    items: ArrayItemSchema | { anyOf: ArrayItemSchema[] }
    itemKey?: (value: any) => string
    itemDescription?: (value: any) => string
    default?: any[]
}

export default function Editor({
    model,
    setModel,
    folders,
    fetchFolders,
    folder,
    setFolder,
    name,
    setName,
    models,
}: {
    model: string
    setModel: (value: string) => void
    folders: string[]
    fetchFolders: () => Promise<void>
    folder: string
    setFolder: (value: string) => void
    name: string
    setName: (value: string | undefined) => void
    models: Model[]
}) {
    const [loading, setLoading] = useState(false)
    const [document, setDocument] = useState<any>({})
    const [documentUpdated, setDocumentUpdated] = useState(false)
    const [newName, setNewName] = useState<string | undefined>(name)
    const [newFolder, setNewFolder] = useState<string>(folder)
    const [path, setPath] = useState<string[]>([])

    const documentModel = useMemo(() => models.find(({ name }) => name === model), [models, model])
    const singularCapitalName = useMemo(() => {
        if (!documentModel?.singularName) return ''
        return `${documentModel.singularName.slice(0, 1).toUpperCase()}${documentModel.singularName.slice(1)}`
    }, [documentModel])

    const leaveEditor = useCallback(() => {
        if (!documentUpdated) {
            setName(undefined)
            setFolder('')
        } else if (window.confirm('Discard changes?')) {
            setName(undefined)
            setFolder('')
        }
    }, [documentUpdated, setName, setFolder])

    const fetchDocument = useCallback(() => {
        if (!name || documentModel?.allowGet === false) return
        setLoading(true)
        try {
            client.getDocument(model, folder, name).then(value => {
                setDocument(value)
                setDocumentUpdated(false)
                setLoading(false)
            })
        } catch (e) {
            console.error(e)
            setName(undefined)
        }
    }, [setLoading, setDocument, setName, name, model, documentModel])
    useEffect(() => {
        fetchDocument()
        // @ts-ignore
        if (name === '') window.document.getElementById('document-name')?.focus()
    }, [])
    const saveDocument = useCallback(async () => {
        if (!newName) return alert(`${documentModel?.singularName} name is required.`)
        setLoading(true)
        try {
            if (!(name === newName && folder === newFolder) && (await client.documentExists(model, newFolder, newName))) {
                if (documentModel?.allowUpdate === false) {
                    alert(`${singularCapitalName} already exists, cancelling.`)
                    return setLoading(false)
                }
                if (!confirm(`${singularCapitalName} already exists, overwrite?`)) return setLoading(false)
            }

            await client.upsertDocument({
                model,
                folder: name ? folder : newFolder,
                newFolder,
                name: name || newName,
                newName,
                value:
                    document instanceof File
                        ? document
                        : {
                              ...document,
                              _modified_at: undefined,
                              _model: model,
                              _folder: newFolder,
                              _name: newName,
                          },
            })

            if (!folders.includes(newFolder)) fetchFolders()

            setDocumentUpdated(false)
            setName(newName)
            setFolder(newFolder)
        } catch (e) {
            alert(`Failed to save ${documentModel?.singularName}.`)
            console.error(e)
        }
        setLoading(false)
    }, [document, setDocumentUpdated, setLoading, name, setName, newName, documentModel, newFolder, folders, fetchFolders])
    const deleteDocument = useCallback(async () => {
        if (!window.confirm(`Delete ${documentModel?.singularName}?`)) return
        setLoading(true)
        try {
            await client.deleteDocument(model, folder, name)
            setName(undefined)
        } catch (e) {
            alert(`Failed to delete ${documentModel?.singularName}.`)
            console.error(e)
        }
        setLoading(false)
    }, [model, name, setLoading, documentModel])

    const [previewing, setPreviewing] = useState(false)
    const previewFrame = useRef(null)

    const previewUpdate = useDebouncedCallback(
        useCallback(() => {
            if (previewFrame.current)
                // @ts-ignore
                previewFrame.current.contentWindow.postMessage({
                    ...document,
                    _modified_at: Math.floor(Date.now() / 1000),
                    _model: model,
                    _folder: newFolder,
                    _name: newName,
                })
        }, [previewFrame, model, newName, document, newFolder]),
        125
    )
    useEffect(previewUpdate, [newName, previewFrame, previewing, document, newFolder])

    return (
        <div className="flex flex-col lg:grid lg:grid-cols-[max-content,auto] min-h-full max-w-[100vw]">
            {!previewing && <div></div>}
            <div
                className={clsx('p-4 flex justify-center', previewing && 'max-w-md border-b lg:border-b-0 lg:border-r border-neutral-300')}
            >
                <div className={clsx('w-full flex flex-col gap-4 transition-[margin]', !previewing && 'lg:mx-[15%] 2xl:mx-[25%]')}>
                    <div className={clsx('grid gap-4', !previewing && 'md:grid-cols-[auto,max-content]')}>
                        <div className="flex gap-2">
                            <button
                                className="h-9"
                                id="document-back"
                                title={path.length ? 'Back [escape]' : `Back to ${model} [escape]`}
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
                            </button>
                            <h1 className="pl-2 text-xl font-semibold flex items-center gap-2">
                                {documentModel?.singularName}
                                {documentUpdated && <span className="text-neutral-400 text-xs font-normal">unsaved changes</span>}
                                <span
                                    className={clsx(
                                        'opacity-0 transition-opacity text-neutral-400 text-xs font-medium select-none',
                                        loading && 'opacity-100'
                                    )}
                                >
                                    loading...
                                </span>
                            </h1>
                        </div>

                        <div className="flex flex-wrap gap-2 items-center">
                            {documentModel?.allowCreate !== false && name && (
                                <button
                                    onClick={() => {
                                        setName('')
                                        setDocumentUpdated(true)
                                    }}
                                    className="action-button"
                                    title={`Duplicate ${documentModel?.singularName}`}
                                >
                                    <span>duplicate</span>
                                    <DuplicateIcon />
                                </button>
                            )}
                            {documentModel?.allowDelete !== false && name && (
                                <button
                                    disabled={DEMO}
                                    onClick={deleteDocument}
                                    className="action-button"
                                    title={`Delete ${documentModel?.singularName}`}
                                >
                                    <span>delete</span>
                                    <TrashIcon />
                                </button>
                            )}
                            {((name && documentModel?.allowUpdate !== false) || (!name && documentModel?.allowCreate !== false)) &&
                                documentUpdated && (
                                    <button
                                        id="save-document"
                                        disabled={loading || DEMO}
                                        onClick={saveDocument}
                                        className="action-button"
                                        title={`Save ${documentModel?.singularName}`}
                                    >
                                        <span>save</span>
                                        <ServerIcon />
                                    </button>
                                )}
                            {documentModel?.previewURL && (
                                <button
                                    onClick={() => {
                                        setPreviewing(!previewing)
                                    }}
                                    className="action-button"
                                    title={`Preview ${documentModel?.singularName}`}
                                >
                                    <span>{previewing && 'end'} preview</span>
                                    {previewing && <LeftArrow />}
                                    {!previewing && <DocumentCheckIcon />}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="border-b border-b-neutral-300 pb-10 mb-4 flex flex-wrap gap-4 items-start">
                        <label
                            htmlFor="document-name"
                            className={clsx('flex flex-col gap-2 cursor-pointer w-full', !previewing && 'md:w-[calc(50%-0.5rem)]')}
                        >
                            <span className="flex gap-2 items-center ml-2">
                                <span className="text-neutral-400">
                                    <FileIcon />
                                </span>
                                <span className="text-sm font-medium">{documentModel?.nameAlias ?? 'name'}</span>
                                {name && name !== newName && <span className="text-xs text-neutral-400 font-normal">changed</span>}
                            </span>
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
                                placeholder={`new ${documentModel?.singularName} ${documentModel?.nameAlias ?? 'name'}`}
                                required
                                title={`${singularCapitalName} ${documentModel?.nameAlias ?? 'name'}`}
                                disabled={Boolean(name) && documentModel?.allowRename === false}
                            />
                        </label>
                        {documentModel?.allowFolders !== false && (
                            <label
                                htmlFor="document-folder"
                                className={clsx('flex flex-col gap-2 cursor-pointer w-full', !previewing && 'md:w-[calc(50%-0.5rem)]')}
                            >
                                <span className="flex gap-2 items-center ml-2">
                                    <span className="text-neutral-400">
                                        <FolderIcon />
                                    </span>
                                    <span className="text-sm font-medium">{documentModel?.folderAlias ?? 'folder'}</span>
                                    {name && folder !== newFolder && <span className="text-xs text-neutral-400 font-normal">changed</span>}
                                </span>
                                <select
                                    id="document-folder"
                                    value={newFolder}
                                    onChange={e => {
                                        const newFolder = e.target.value

                                        if (newFolder === '[new]') {
                                            const newFolderName = prompt(`Enter new ${documentModel?.folderAlias ?? 'folder'} name:`)
                                            if (newFolderName) {
                                                setNewFolder(newFolderName)
                                                setDocumentUpdated(true)
                                            }
                                        } else {
                                            setNewFolder(newFolder)
                                            setDocumentUpdated(true)
                                        }
                                    }}
                                    required
                                    title={`${singularCapitalName} ${documentModel?.folderAlias ?? 'folder'}`}
                                    disabled={documentModel?.allowRename}
                                >
                                    <option value="" selected={!newFolder}>
                                        (none)
                                    </option>
                                    {documentModel?.allowCreateFolder !== false && (
                                        <option value="[new]">+ new {documentModel?.folderAlias ?? 'folder'}</option>
                                    )}
                                    {newFolder && !folders.includes(newFolder) && (
                                        <option key={newFolder} selected={true}>
                                            {newFolder}
                                        </option>
                                    )}
                                    {folders.map(folderName => {
                                        return (
                                            <option key={folderName} selected={newFolder === folderName}>
                                                {folderName}
                                            </option>
                                        )
                                    })}
                                </select>
                            </label>
                        )}
                    </div>

                    {Boolean(path.length) && (
                        <div className="flex gap-2 items-center">
                            <button
                                title="Back"
                                className="mr-2"
                                onClick={() => {
                                    const last = path.pop()
                                    if (!isNaN(Number(last))) path.pop()
                                    setPath([...path])
                                    return
                                }}
                            >
                                <LeftArrow />
                            </button>
                            {path.map((piece, i) => (
                                <>
                                    <span className="text-xs font-medium text-neutral-500">
                                        {isNaN(Number(piece)) ? piece : Number(piece) + 1}
                                    </span>
                                    {i !== path.length - 1 && <span className="text-xs font-medium text-neutral-300">/</span>}
                                </>
                            ))}
                        </div>
                    )}
                    {documentModel &&
                        (documentModel.customEditor ? (
                            <documentModel.customEditor
                                {...{
                                    model,
                                    folder,
                                    name,
                                    setName,
                                    newName,
                                    setNewName,
                                    path,
                                    setPath,
                                    document,
                                    setDocument,
                                    documentUpdated,
                                    setDocumentUpdated,
                                    documentModel,
                                    previewing,
                                    loading,
                                }}
                            />
                        ) : (
                            <EditorFields
                                {...{
                                    model,
                                    folder,
                                    name,
                                    setName,
                                    newName,
                                    setNewName,
                                    path,
                                    setPath,
                                    document,
                                    setDocument,
                                    documentUpdated,
                                    setDocumentUpdated,
                                    documentModel,
                                    previewing,
                                    loading,
                                }}
                            />
                        ))}
                </div>
            </div>
            {previewing && documentModel?.previewURL && (
                <iframe className="w-full h-full" ref={previewFrame} src={documentModel.previewURL(document)}></iframe>
            )}
        </div>
    )
}
