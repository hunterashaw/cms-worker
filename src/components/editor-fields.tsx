import React, { useMemo } from 'react'
import { ArraySchema, ObjectSchema } from './editor'
import clsx from 'clsx'
import { CheckboxIcon, PlusIcon, RightArrow, TrashIcon } from './icons'
import EditorReference from './editor-reference'
import {
    MDXEditor,
    toolbarPlugin,
    headingsPlugin,
    listsPlugin,
    quotePlugin,
    BoldItalicUnderlineToggles,
    BlockTypeSelect,
    ListsToggle,
    CreateLink,
    linkDialogPlugin
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

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

export default function EditorFields({
    path,
    setPath,
    document,
    setDocument,
    setDocumentUpdated,
    documentSchema
}: {
    path: string[]
    setPath: (value: string[]) => void
    document: any
    setDocument: (value: any) => void
    setDocumentUpdated: (value: boolean) => void
    documentSchema: ObjectSchema
}) {
    const { currentValue, currentSchema } = useMemo(() => {
        let currentValue
        let currentSchema: ObjectSchema | ArraySchema

        if (document && documentSchema) {
            currentValue = document
            currentSchema = documentSchema

            for (const piece of path) {
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
    }, [path, document, documentSchema])

    return (
        <div className="flex flex-col gap-4">
            {currentSchema?.title && <span className="ml-2 text-sm font-medium">{currentSchema.title}</span>}
            {currentSchema?.description && (
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
                        set(document, [...path, key], newValue)
                        setDocument({ ...document })
                        setDocumentUpdated(true)
                    }

                    if (keySchema.type === 'object')
                        return (
                            <div key={key}>
                                <button title={keySchema?.description ?? key} onClick={() => setPath([...path, key])}>
                                    <span>{title}</span>
                                    <RightArrow />
                                </button>
                            </div>
                        )

                    const input = (() => {
                        if (keySchema.type === 'string') {
                            if (keySchema.format === 'uri')
                                return (
                                    <EditorReference
                                        {...{
                                            id,
                                            value: keyValue,
                                            schema: keySchema,
                                            update
                                        }}
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
                            if (keySchema.format === 'markdown')
                                return (
                                    <MDXEditor
                                        plugins={[
                                            toolbarPlugin({
                                                toolbarClassName: 'rich-toolbar',
                                                toolbarContents: () => (
                                                    <>
                                                        <BlockTypeSelect />
                                                        <BoldItalicUnderlineToggles />
                                                        <ListsToggle />
                                                    </>
                                                )
                                            }),
                                            headingsPlugin(),
                                            listsPlugin(),
                                            quotePlugin()
                                        ]}
                                        markdown={keyValue ?? ''}
                                        onChange={value => update(value)}
                                    />
                                )
                            if (keySchema.enum)
                                return (
                                    <select id={id} value={keyValue} onChange={e => update(e.target.value)}>
                                        <option className="text-neutral-500" value=""></option>
                                        {keySchema.enum.map(option => (
                                            <option key={option}>{option}</option>
                                        ))}
                                    </select>
                                )
                            return <input id={id} value={keyValue} onChange={e => update(e.target.value as string)} />
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

                                    {keyValue?.map((item, i) => {
                                        const itemKey = keySchema.itemKey ? keySchema.itemKey(item) : undefined
                                        return (
                                            <div
                                                className="rounded-none border-b border-b-neutral-200 last:rounded-b-md last:border-b-0 grid grid-cols-[auto,max-content] p-0 group"
                                                key={itemKey ? itemKey + i : item._id}
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
                    })()

                    return (
                        <label
                            key={[...path, key].join('.')}
                            htmlFor={id}
                            className="flex flex-col gap-2 cursor-pointer"
                        >
                            <span className="flex gap-2 items-center">
                                <span className="text-sm font-medium ml-2">{title}</span>
                                <span className="text-xs text-neutral-500">{keySchema?.description}</span>
                            </span>
                            {input}
                        </label>
                    )
                })
            }
        </div>
    )
}
