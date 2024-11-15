import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { client, Model } from './app'
import clsx from 'clsx'
import { UserIcon, FileIcon, PlusIcon, RightArrow } from './icons'
import { useDebouncedCallback } from 'use-debounce'

export default function Documents({
    models,
    model,
    setModel,
    setName
}: {
    models: Model[]
    model: string
    setModel: (value: string) => void
    setName: (value: string) => void
}) {
    const [loading, setLoading] = useState(true)
    const [documents, setDocuments] = useState<
        { name: string; created_at: number; modified_at: number; modified_by: string }[]
    >([])
    const [prefix, setPrefix] = useState('')

    const { isUsers, isFiles } = useMemo(() => ({ isUsers: model === 'users', isFiles: model === 'files' }), [model])
    const [last, setLast] = useState<string | null>(null)
    const fetchDocuments = useDebouncedCallback(
        useCallback(
            async (next = false) => {
                setLoading(true)
                const after = next ? last || undefined : undefined
                if (!next) {
                    setLoading(true)
                    setDocuments([])
                }

                if (isFiles)
                    await client
                        .listFiles({ prefix: prefix || undefined, after })
                        .then(({ results, last }) => {
                            if (next) setDocuments([...documents, ...results])
                            else setDocuments(results)
                            setLast(last)
                        })
                        .catch(() => {
                            setDocuments([])
                            alert('Failed to load results.')
                        })
                else if (isUsers)
                    await client
                        .listUsers(prefix || undefined)
                        .then(users => {
                            setDocuments(
                                users.map(({ email }) => ({
                                    name: email,
                                    created_at: 0,
                                    modified_at: 0,
                                    modified_by: ''
                                }))
                            )
                            setLast(null)
                        })
                        .catch(() => {
                            setDocuments([])
                            alert('Failed to load results.')
                        })
                else
                    await client
                        .listDocuments(model, { prefix: prefix || undefined, after })
                        .then(({ results, last }) => {
                            if (next) setDocuments([...documents, ...results])
                            else setDocuments(results)
                            setLast(last)
                        })
                        .catch(() => {
                            setDocuments([])
                            alert('Failed to load results.')
                        })

                setLoading(false)
            },
            [setLoading, setDocuments, model, isUsers, isFiles, prefix, last, setLast]
        ),
        125
    )
    useEffect(() => {
        fetchDocuments()
    }, [model, prefix])

    return (
        <div className="grid grid-cols-[max-content,auto]">
            <div className="p-4 flex flex-col">
                {models.map(({ name, key }) => {
                    const selected = model == name
                    return (
                        <button
                            key={`${name}/${key ?? ''}`}
                            className={clsx(
                                'rounded-none first:rounded-t-md border-b-0',
                                selected && 'bg-blue-50 hover:bg-blue-100'
                            )}
                            onClick={() => {
                                setPrefix('')
                                if (selected) fetchDocuments()
                                else setModel(name)
                            }}
                        >
                            <span>
                                {name}
                                {key && `/${key}`}
                            </span>
                            <RightArrow />
                        </button>
                    )
                })}
                <button
                    onClick={() => {
                        setPrefix('')
                        if (model === 'files') fetchDocuments()
                        else setModel('files')
                    }}
                    className={clsx('rounded-none border-b-0', model === 'files' && 'bg-blue-50 hover:bg-blue-100')}
                >
                    <span>files</span>
                    <FileIcon />
                </button>
                <button
                    onClick={() => {
                        setPrefix('')
                        if (model === 'users') fetchDocuments()
                        else setModel('users')
                    }}
                    className={clsx('rounded-t-none', model === 'users' && 'bg-blue-50 hover:bg-blue-100')}
                >
                    <span>users</span>
                    <UserIcon />
                </button>
            </div>
            <div className="flex justify-center p-4">
                <div className="w-full max-w-xl h-max flex flex-col gap-4">
                    <div className="grid grid-cols-[auto,max-content] gap-4 items-center">
                        <h1 className="pl-2 text-lg font-medium flex items-center gap-2">
                            {model || '/'}
                            {loading && <span className="text-neutral-500 text-sm font-medium">loading...</span>}
                        </h1>
                        <div className="flex gap-2">
                            <button id="new-document" onClick={() => setName('')}>
                                <PlusIcon />
                                <span>new</span>
                            </button>
                        </div>
                    </div>

                    <div>
                        <input
                            id="search"
                            className="w-72"
                            type="search"
                            placeholder="prefix search"
                            value={prefix}
                            onChange={e => {
                                setPrefix(e.target.value)
                            }}
                        />
                    </div>

                    <div className={clsx('transition-opacity', loading && 'opacity-50')}>
                        <div className="grid-header">
                            <span>{isUsers ? 'email' : 'name'}</span>
                            {!isUsers && (
                                <>
                                    <span>last modified</span>
                                </>
                            )}
                        </div>
                        {documents.length === 0 && (
                            <div className="grid-row hover:bg-white cursor-default">
                                <span>no documents</span>
                            </div>
                        )}
                        {documents.map((document, i) => {
                            const created_at = new Date(document.created_at * 1000)
                            const modified_at = new Date(document.modified_at * 1000)
                            return (
                                <div
                                    key={document.name}
                                    className="grid-row"
                                    onClick={() => setName(document.name)}
                                    tabIndex={i + 1}
                                    role="button"
                                >
                                    <span>
                                        <span>{document.name}</span>
                                        <RightArrow />
                                    </span>
                                    <span title={modified_at.toLocaleString()}>
                                        {Boolean(document.modified_at) && modified_at.toLocaleDateString()}
                                    </span>
                                </div>
                            )
                        })}
                    </div>

                    {last && (
                        <div className="flex justify-center">
                            <button onClick={() => fetchDocuments(true)}>load more</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
