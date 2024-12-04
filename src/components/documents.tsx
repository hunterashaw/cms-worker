import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { client, Model } from './app'
import clsx from 'clsx'
import { UserIcon, FileIcon, PlusIcon, RightArrow, FolderIcon } from './icons'
import { useDebouncedCallback } from 'use-debounce'

export default function Documents({
    path,
    setPath,
    setName,
    models,
    rootFolders,
}: {
    path: string
    setPath: (value: string) => void
    setName: (value: string) => void
    models: Model[]
    rootFolders: string[]
}) {
    const [loading, setLoading] = useState(true)
    const [documents, setDocuments] = useState<{ name: string; modified_at: number }[]>([])
    const [folders, setFolders] = useState<{ name: string }[]>([])
    const [prefix, setPrefix] = useState('')

    const isUsers = useMemo(() => path === 'users', [path])
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

                if (isUsers)
                    await client
                        .listUsers(prefix || undefined)
                        .then(users => {
                            setDocuments(
                                users.map(({ email }) => ({
                                    name: email,
                                    modified_at: 0,
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
                        .listDocuments({ path, prefix: prefix || undefined, after })
                        .then(({ documents: results, folders, last }) => {
                            if (folders) setFolders(folders)

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
            [setLoading, setDocuments, path, isUsers, prefix, last, setLast]
        ),
        125
    )
    useEffect(() => {
        fetchDocuments()
    }, [path, prefix])

    return (
        <div className="flex justify-center p-4">
            <div className="w-full max-w-xl h-max flex flex-col gap-4">
                <div className="grid grid-cols-[auto,max-content] gap-4 items-center">
                    <h1 className="pl-2 text-lg font-medium flex items-center gap-2">
                        {path}
                        {loading && <span className="text-neutral-500 text-sm font-medium">loading...</span>}
                    </h1>
                    <div className="flex gap-2">
                        <button id="new-folder" onClick={() => setName('')}>
                            <PlusIcon />
                            <span>folder</span>
                        </button>
                        <button id="new-document" onClick={() => setName('')}>
                            <PlusIcon />
                            <span>document</span>
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

                <div className="flex gap-4 flex-wrap">
                    {!path &&
                        [rootFolders, 'files', 'users'].map(name => (
                            <button>
                                <FolderIcon />
                                <span className="text-sm">{name}</span>
                            </button>
                        ))}
                    {path &&
                        folders.map(({ name }) => (
                            <button>
                                <FolderIcon />
                                <span className="text-sm">{name}</span>
                            </button>
                        ))}
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
    )
}
