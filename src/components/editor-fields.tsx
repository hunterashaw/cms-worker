import React, { useMemo } from 'react'
import { ArraySchema, ObjectSchema, PropertySchema } from './editor'
import clsx from 'clsx'
import { CheckboxIcon, PlusIcon, RightArrow, TrashIcon } from './icons'
import {
    MDXEditor,
    headingsPlugin,
    imagePlugin,
    linkPlugin,
    linkDialogPlugin,
    listsPlugin,
    quotePlugin,
    toolbarPlugin,
    BoldItalicUnderlineToggles,
    BlockTypeSelect,
    CreateLink,
    InsertImage,
    ListsToggle,
    UndoRedo,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { client, Model } from './app'

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

export type EditorFieldsProps = {
    model: string
    folder: string | undefined
    name: string | undefined
    setName: (value: string | undefined) => void
    newName: string | undefined
    setNewName: (value: string | undefined) => void
    path: string[]
    setPath: (value: string[]) => void
    document: any
    setDocument: (value: any) => void
    documentUpdated: boolean
    setDocumentUpdated: (value: boolean) => void
    documentModel: Model
    previewing: boolean
    loading: boolean
}

export default function EditorFields({
    path,
    setPath,
    document,
    setDocument,
    setDocumentUpdated,
    documentModel,
    previewing,
    loading,
}: EditorFieldsProps) {
    const { currentValue, currentSchema } = useMemo(() => {
        let currentValue
        let currentSchema: ObjectSchema | ArraySchema

        if (document && documentModel.schema) {
            currentValue = document
            currentSchema = typeof documentModel.schema === 'function' ? documentModel.schema(document) : documentModel.schema

            for (const piece of path) {
                // Lookup path property schema OR array item schema
                // @ts-ignore currentSchema is ObjectSchema
                if (isNaN(Number(piece))) currentSchema = currentSchema.properties[piece]
                else {
                    // @ts-ignore currentSchema is ArraySchema
                    if ((currentSchema as ArraySchema).items?.anyOf) {
                        const itemType = currentValue[piece]._type
                        // @ts-ignore currentSchema is ArraySchema
                        currentSchema = currentSchema.items.anyOf.find(item => {
                            const currentReference = item?.$ref as string | undefined
                            if (currentReference) {
                                if (!documentModel.schemaReferences || !documentModel.schemaReferences[currentReference]) {
                                    alert(`Missing schema reference "${currentReference}"`)
                                    throw new Error(`Missing schema reference "${currentReference}"`)
                                }
                                return documentModel.schemaReferences[currentReference].title === itemType
                            }
                            return item.title === itemType
                        })
                        // @ts-ignore currentSchema is ArraySchema
                    } else currentSchema = currentSchema.items
                }

                // @ts-ignore currentSchema might be a reference
                const currentReference = currentSchema?.$ref as string | undefined
                if (currentReference) {
                    if (!documentModel.schemaReferences || !documentModel.schemaReferences[currentReference]) {
                        alert(`Missing schema reference "${currentReference}"`)
                        throw new Error(`Missing schema reference "${currentReference}"`)
                    }
                    currentSchema = documentModel.schemaReferences[currentReference] as ObjectSchema
                }

                // Create document structure as-needed
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
    }, [path, document, documentModel])

    return (
        <div className={clsx('flex flex-wrap gap-4', loading && 'animate-pulse')}>
            {(currentSchema?.title || currentSchema?.description) && (
                <div className="w-full flex gap-2 ml-2 items-center">
                    {currentSchema?.title && <span className="text-sm font-medium">{currentSchema.title}</span>}
                    {currentSchema?.description && (
                        <span className="text-xs font-normal text-neutral-500">{currentSchema.description}</span>
                    )}
                </div>
            )}
            {
                /* @ts-ignore */
                Object.keys(currentSchema?.properties ?? {}).map(key => {
                    const id = `editor-field-${key}`

                    const currentObjectSchema = currentSchema as ObjectSchema
                    let keySchema: PropertySchema
                    // @ts-ignore $ref can be undefined
                    const keySchemaReference = currentObjectSchema.properties[key]?.$ref
                    if (keySchemaReference) {
                        if (!documentModel.schemaReferences || !documentModel.schemaReferences[keySchemaReference]) {
                            alert(`Missing schema reference "${keySchemaReference}"`)
                            throw new Error(`Missing schema reference "${keySchemaReference}"`)
                        }
                        keySchema = documentModel.schemaReferences[keySchemaReference]
                    } else keySchema = currentObjectSchema.properties[key] as PropertySchema

                    const keyValue = currentValue[key] ?? keySchema?.default

                    const title = keySchema?.title ?? key

                    const update = newValue => {
                        set(document, [...path, key], newValue)
                        setDocument({ ...document })
                        setDocumentUpdated(true)
                    }

                    if (keySchema.type === 'object')
                        return (
                            <div className={clsx('w-full', !previewing && 'md:w-[calc(50%-0.5rem)]')} key={key}>
                                <button title={keySchema?.description ?? key} onClick={() => setPath([...path, key])}>
                                    <span>{title}</span>
                                    <RightArrow />
                                </button>
                            </div>
                        )

                    let fullWidth = false
                    const input = (() => {
                        if (keySchema.type === 'string') {
                            if (keySchema.format === 'date-time')
                                return (
                                    <input
                                        id={id}
                                        type="datetime-local"
                                        value={keyValue}
                                        onChange={e => update(e.target.value as string)}
                                        disabled={loading}
                                    />
                                )
                            if (keySchema.format === 'markdown') {
                                if (loading) return
                                fullWidth = true
                                return (
                                    <MDXEditor
                                        plugins={[
                                            toolbarPlugin({
                                                toolbarClassName: 'rich-toolbar',
                                                toolbarContents: () => (
                                                    <>
                                                        <UndoRedo />
                                                        <BlockTypeSelect />
                                                        <BoldItalicUnderlineToggles />
                                                        <ListsToggle options={['bullet', 'number']} />
                                                        <CreateLink />
                                                        <InsertImage />
                                                    </>
                                                ),
                                            }),
                                            headingsPlugin(),
                                            listsPlugin(),
                                            quotePlugin(),
                                            imagePlugin({
                                                async imageUploadHandler(image) {
                                                    try {
                                                        let name = image.name
                                                        if (await client.documentExists('files', 'images', name)) {
                                                            const random = Math.floor(Math.random() * 1000)
                                                                .toString()
                                                                .padStart(4, '0')

                                                            const pieces = name.split('.')
                                                            name = `${pieces[0]}-${random}.${pieces[1]}`
                                                        }
                                                        await client.upsertDocument({
                                                            model: 'files',
                                                            folder: 'images',
                                                            name,
                                                            value: image,
                                                        })

                                                        const url = new URL(window.location.href)
                                                        url.pathname = `/files/images/${name}`
                                                        url.search = ''
                                                        return url.toString()
                                                    } catch (e) {
                                                        console.error(e)
                                                        alert('Cannot upload image.')
                                                    }
                                                    return ''
                                                },
                                            }),
                                            linkPlugin(),
                                            linkDialogPlugin(),
                                        ]}
                                        markdown={keyValue ?? ''}
                                        onChange={value => update(value)}
                                    />
                                )
                            }
                            if (keySchema.enum)
                                return (
                                    <select id={id} value={keyValue} onChange={e => update(e.target.value)} disabled={loading}>
                                        <option className="text-neutral-500" value=""></option>
                                        {keySchema.enum.map(option => (
                                            <option key={option}>{option}</option>
                                        ))}
                                    </select>
                                )
                            return <input id={id} value={keyValue} onChange={e => update(e.target.value as string)} disabled={loading} />
                        }
                        if (keySchema.type === 'number')
                            return (
                                <input
                                    type="number"
                                    id={id}
                                    value={keyValue as string}
                                    onChange={e => update(Number(e.target.value))}
                                    disabled={loading}
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
                                        disabled={loading}
                                    />
                                </label>
                            )
                        if (keySchema.type === 'array') {
                            fullWidth = true
                            const AddItemButton = props => (
                                <button
                                    key={props.key}
                                    className={clsx(
                                        'rounded-none border-0 first:rounded-t-md last:rounded-b-md bg-white border-b border-b-neutral-200 last:border-b-0',
                                        keyValue?.length && 'border-b'
                                    )}
                                    onClick={() => {
                                        update([
                                            ...(keyValue ?? []),
                                            {
                                                ...(props?.default ?? {}),
                                                _id: nextID(keyValue),
                                                _type: props.title,
                                            },
                                        ])
                                        setPath([...path, key, (keyValue ? keyValue.length : 0).toString()])
                                    }}
                                    disabled={loading}
                                >
                                    <PlusIcon />
                                    <span>{props?.title}</span>
                                    <span className="text-xs font-normal text-neutral-500">{props?.description}</span>
                                </button>
                            )

                            return (
                                <div
                                    className={clsx(
                                        'rounded-md flex flex-col border border-neutral-300 w-full',
                                        !previewing && 'md:w-[calc(75%-0.5rem)]'
                                    )}
                                >
                                    {
                                        /* @ts-ignore */
                                        keySchema?.items?.anyOf &&
                                            /* @ts-ignore */
                                            keySchema.items.anyOf.map((item, i) => {
                                                let itemSchema: ObjectSchema
                                                const itemSchemaReference = item?.$ref
                                                if (itemSchemaReference) {
                                                    if (
                                                        !documentModel.schemaReferences ||
                                                        !documentModel.schemaReferences[itemSchemaReference]
                                                    ) {
                                                        alert(`Missing schema reference "${itemSchemaReference}"`)
                                                        throw new Error(`Missing schema reference "${itemSchemaReference}"`)
                                                    }

                                                    itemSchema = documentModel.schemaReferences[itemSchemaReference]
                                                } else itemSchema = item

                                                return <AddItemButton {...{ key: i, ...itemSchema }} />
                                            })
                                    }
                                    {
                                        /* @ts-ignore */
                                        keySchema?.items?.properties && <AddItemButton {...{ key: -1, ...keySchema?.items }} />
                                    }
                                    {
                                        /* @ts-ignore */
                                        keySchema?.items?.$ref &&
                                            documentModel.schemaReferences &&
                                            /* @ts-ignore */
                                            documentModel.schemaReferences[keySchema?.items?.$ref] && (
                                                <AddItemButton
                                                    /* @ts-ignore */
                                                    {...{ key: -1, ...documentModel.schemaReferences[keySchema?.items?.$ref] }}
                                                />
                                            )
                                    }
                                    {keyValue?.map((item, i) => {
                                        const itemKey = keySchema.itemKey ? keySchema.itemKey(item) : undefined
                                        const itemDescription = keySchema.itemDescription ? keySchema.itemDescription(item) : undefined

                                        return (
                                            <div
                                                className="rounded-none border-b border-b-neutral-200 last:rounded-b-md last:border-b-0 grid grid-cols-[auto,max-content] p-0 group"
                                                key={itemKey ? itemKey + i : item._id}
                                                draggable="true"
                                                onDragStart={e => {
                                                    e.dataTransfer.setData('application/json', JSON.stringify({ key, i }))
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
                                                        const payload = JSON.parse(e.dataTransfer.getData('application/json')) as {
                                                            key: string
                                                            i: number
                                                        }
                                                        if (key !== payload.key) throw new Error('Cannot drop between keys.')
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
                                                    onClick={() => setPath([...path, key, i.toString()])}
                                                >
                                                    <span>
                                                        {itemKey && itemKey}
                                                        {!itemKey && (
                                                            <>
                                                                {item._type} {item._id}
                                                            </>
                                                        )}
                                                    </span>
                                                    <RightArrow />
                                                    {itemDescription && (
                                                        <span className="font-normal text-xs text-neutral-400">{itemDescription}</span>
                                                    )}
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
                                        )
                                    })}
                                </div>
                            )
                        }
                    })()

                    return (
                        <label
                            key={[...path, key].join('.')}
                            htmlFor={id}
                            className={clsx(
                                'flex flex-col gap-2 cursor-pointer w-full',
                                !fullWidth && !previewing && 'md:w-[calc(50%-0.5rem)]'
                            )}
                        >
                            <span className="text-sm font-medium ml-2">{title}</span>
                            {input}
                            {keySchema?.description && <span className="ml-2 text-xs text-neutral-500">{keySchema?.description}</span>}
                        </label>
                    )
                })
            }
        </div>
    )
}
