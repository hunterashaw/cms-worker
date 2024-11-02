import React, { useState } from 'react'
import { client } from './app'

export default function Header({ setAuthenticated }: { setAuthenticated: (value: boolean) => void }) {
    const [loggingOut, setLoggingOut] = useState<boolean>(false)
    return (
        <header className="px-4 py-2 bg-neutral-800 text-white grid gap-2 grid-cols-[auto,max-content]">
            <span></span>
            <div className="flex gap-4 items-center">
                <span className="select-none text-sm">{client.email}</span>
                <button
                    onClick={async e => {
                        setLoggingOut(true)
                        setAuthenticated(!(await client.deleteSession()))
                        setLoggingOut(false)
                    }}
                    disabled={loggingOut}
                    className="text-black py-1 text-xs"
                >
                    {loggingOut ? 'logging out...' : 'logout'}
                </button>
            </div>
        </header>
    )
}
