import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ReferenceSchema } from './editor'
import { client } from './app'
import { useDebouncedCallback } from 'use-debounce'
import { UploadIcon, SearchIcon } from './icons'

export default function Reference({
    id,
    value,
    schema,
    update
}: {
    id: string
    value?: string
    schema: ReferenceSchema
    update: (value: string) => void
}) {
    const { isFiles, isUsers } = useMemo(() => {
        return { isFiles: schema.model === 'files', isUsers: schema.model === 'users' }
    }, [schema.model])
    const [editing, setEditing] = useState(false)

    const [prefix, setPrefix] = useState('')
    const [results, setResults] = useState<{ name: string }[]>([])
    const [loading, setLoading] = useState(false)
    const getResults = useDebouncedCallback(
        useCallback(() => {
            if (isFiles)
                client.listFiles({ prefix, limit: 5 }).then(({ results }) => {
                    setResults(results)
                })
            else if (isUsers)
                client.listUsers(prefix).then(value => {
                    setResults(value.map(({ email }) => ({ name: email })))
                })
            else
                client.listDocuments(schema.model, { prefix, limit: 5 }).then(({ results }) => {
                    setResults(results)
                })
            setLoading(false)
        }, [setResults, prefix, isFiles, isUsers, schema, setLoading]),
        125
    )
    useEffect(() => {
        if (editing) {
            setLoading(true)
            getResults()
        }
    }, [editing, prefix])

    const prefixInput = useRef(null)

    useEffect(() => {
        if (editing && prefixInput.current)
            // @ts-ignore
            prefixInput.current.focus()
    }, [editing, prefixInput])

    return (
        <>
            {!editing && (
                <div className="grid grid-cols-[auto,max-content] gap-2">
                    <a
                        href={value ? `?model=${schema.model}&name=${value}` : '/'}
                        target="_blank"
                        onClick={e => {
                            if (!value) {
                                e.preventDefault()
                                setEditing(true)
                                setPrefix('')
                            }
                        }}
                        className="px-4 py-2 border rounded-md border-neutral-300 text-sm"
                    >
                        {value}
                    </a>
                    <button
                        onClick={() => {
                            setEditing(true)
                            setPrefix('')
                        }}
                    >
                        <span>pick</span>
                        <SearchIcon />
                    </button>
                </div>
            )}
            {editing && (
                <div className="grid grid-cols-[auto,max-content] gap-2">
                    <input
                        id={id}
                        ref={prefixInput}
                        placeholder={`prefix search ${schema.model}`}
                        value={prefix}
                        onChange={e => setPrefix(e.target.value)}
                    />
                    <button onClick={() => setEditing(false)}>cancel</button>
                    {loading ? (
                        <span className="px-4 py-2 opacity-50 text-sm">loading...</span>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {isFiles && (
                                <>
                                    <input
                                        id={`${id}-upload`}
                                        type="file"
                                        className="hidden"
                                        onChange={async e => {
                                            try {
                                                const file = e.target.files?.item(0)
                                                if (!file) return
                                                if (await client.fileExists(file.name))
                                                    if (!confirm('File already exists, overwrite?')) return

                                                await client.upsertFile(file.name, file)
                                                setEditing(false)
                                                update(file.name)
                                            } catch (e) {
                                                alert('Error uploading file.')
                                                console.error(e)
                                            }
                                        }}
                                    />
                                    <label htmlFor={`${id}-upload`} className="button w-max" role="button">
                                        <span>upload</span>
                                        <UploadIcon />
                                    </label>
                                </>
                            )}
                            {results.length === 0 && (
                                <span className="px-4 py-2 text-neutral-500 text-sm cursor-default select-none">
                                    no {schema.model} found
                                </span>
                            )}
                            {!loading &&
                                results.map(({ name }) => (
                                    <button
                                        key={name}
                                        onClick={() => {
                                            setEditing(false)
                                            update(name)
                                        }}
                                        className="w-full"
                                    >
                                        {name}
                                    </button>
                                ))}
                        </div>
                    )}
                </div>
            )}
        </>
    )
}
