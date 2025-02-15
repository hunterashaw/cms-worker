import React, { useCallback, useState } from 'react'
import { client } from './app'
import { vars as environment } from '../../wrangler.json'

const DEMO = environment?.DEMO

export default function Login({ setAuthenticated }: { setAuthenticated: (value: boolean) => void }) {
    const [loading, setLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | undefined>()
    const [email, setEmail] = useState<string>('admin@example.com')
    const [verification, setVerification] = useState<string>('1234')
    const [sending, setSending] = useState<boolean>(false)
    const [verificationMessage, setVerificationMessage] = useState<string>('')

    const sendVerification = useCallback(async () => {
        setSending(true)
        if (await client.sendVerification(email)) setVerificationMessage('Verification sent.')
        else setVerificationMessage('Unable to send verification.')
        setSending(false)
    }, [setSending, setVerificationMessage, email])

    return (
        <div className="h-full p-8 flex justify-center">
            <form
                className="flex flex-col gap-2 w-full max-w-80"
                onSubmit={async e => {
                    e.preventDefault()
                    setLoading(true)

                    try {
                        setAuthenticated(await client.createSession(email, verification))
                    } catch (e) {
                        setError('Invalid credentials.')
                        console.error(e)
                    }

                    setLoading(false)
                }}
            >
                <label className="flex flex-col gap-2" htmlFor="email">
                    <span className="pl-2 text-sm font-medium">email</span>
                    <input
                        required
                        type="email"
                        autoComplete="on"
                        id="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault()
                                sendVerification()
                            }
                        }}
                        disabled={DEMO}
                    />
                </label>
                <div className="grid grid-cols-[auto,max-content] gap-2 mt-2 items-center">
                    <span className="text-xs pl-2 font-medium">{verificationMessage}</span>
                    <button
                        type="button"
                        disabled={DEMO || sending}
                        onClick={async e => {
                            e.preventDefault()
                            sendVerification()
                        }}
                    >
                        {sending ? 'sending...' : 'send verification'}
                    </button>
                </div>
                <label className="flex flex-col gap-2" htmlFor="verification">
                    <span className="pl-2 text-sm font-medium">verification</span>
                    <input
                        required
                        id="verification"
                        autoComplete="off"
                        value={verification}
                        onClick={e => {
                            // @ts-ignore
                            e.target.select()
                        }}
                        disabled={DEMO}
                        onChange={e => setVerification(e.target.value)}
                    />
                </label>
                <div className="grid grid-cols-[auto,max-content] gap-2 mt-2 items-center">
                    <span className="text-xs text-red-500">{error}</span>
                    <button disabled={loading} type="submit">
                        {loading ? 'loading...' : 'login'}
                    </button>
                </div>
            </form>
        </div>
    )
}
