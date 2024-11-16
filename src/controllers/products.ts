import { ModelController } from '../worker'

/** Example BigCommerce Products Controller */
export const productsController: ModelController = {
    async list({ prefix, limit, after }, { environment: { BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN } }) {
        if (!BIGCOMMERCE_HASH || !BIGCOMMERCE_TOKEN) throw new Error('BigCommerce credentials are missing.')
        const store = new BigCommerceStore(BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN)
        const page = after ? Number(after) : 1

        const results = (await store.get('v3/catalog/products', {
            queries: {
                include_fields: 'name,date_modified',
                limit,
                page,
                keyword: prefix
            }
        })) as { name: string; date_modified: string }[]

        return {
            results: results.map(({ name, date_modified }) => ({
                name,
                modified_at: Math.round(new Date(date_modified).getTime() / 1000)
            })),
            last: results.length === limit ? page + 1 : undefined
        }
    },
    async exists(name, { environment: { BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN } }) {
        if (!BIGCOMMERCE_HASH || !BIGCOMMERCE_TOKEN) throw new Error('BigCommerce credentials are missing.')
        const store = new BigCommerceStore(BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN)
        const [existing] = await store.get('v3/catalog/products', { queries: { name, limit: 1, include_fields: 'id' } })
        return Boolean(existing)
    },
    async get(name, { environment: { BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN } }) {
        if (!BIGCOMMERCE_HASH || !BIGCOMMERCE_TOKEN) throw new Error('BigCommerce credentials are missing.')
        const store = new BigCommerceStore(BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN)
        const [existing] = await store.get('v3/catalog/products', {
            queries: { name, limit: 1, include: 'custom_fields,images' }
        })
        return { value: existing, modified_at: Math.round(new Date(existing.date_modified).getTime() / 1000) }
    },
    async put({ name, rename, value }, { environment: { BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN } }) {
        if (!BIGCOMMERCE_HASH || !BIGCOMMERCE_TOKEN) throw new Error('BigCommerce credentials are missing.')
        const store = new BigCommerceStore(BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN)
        const [existing] = await store.get('v3/catalog/products', { queries: { name, limit: 1, include_fields: 'id' } })
        if (rename) value.name = rename
        if (existing) await store.put(`v3/catalog/products/${existing.id}`, { body: value })
        else await store.post(`v3/catalog/products`, { body: value })
    },
    async delete(name, { environment: { BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN } }) {
        if (!BIGCOMMERCE_HASH || !BIGCOMMERCE_TOKEN) throw new Error('BigCommerce credentials are missing.')
        const store = new BigCommerceStore(BIGCOMMERCE_HASH, BIGCOMMERCE_TOKEN)
        const [existing] = await store.get('v3/catalog/products', { queries: { name, limit: 1, include_fields: 'id' } })
        if (existing) await store.delete(`v3/catalog/products/${existing.id}`)
    }
}

type FetchParameters = {
    method?: 'get' | 'post' | 'put' | 'delete'
    body?: any
    queries?: Record<string, any>
    raw?: boolean
}

export default class BigCommerceStore {
    hash
    token

    constructor(hash: string, token: string) {
        this.hash = hash
        this.token = token
    }

    async fetch(endpoint: string, params?: FetchParameters) {
        const url = new URL(`https://api.bigcommerce.com/stores/${this.hash}/${endpoint}`)
        Object.entries(params?.queries ?? {}).forEach(([name, value]) => {
            if (name && value) url.searchParams.append(name, value)
        })
        const headers = {
            accept: 'application/json',
            'x-auth-token': this.token
        }
        if (params?.body) headers['content-type'] = 'application/json'
        let request
        for (let tries = 0; tries < 3; tries++) {
            request = await fetch(url, {
                method: params?.method,
                body: params?.body ? JSON.stringify(params.body) : undefined,
                headers
            })
            console.log(
                `${(params?.method ?? 'get').toUpperCase()} ${url.toString()} - ${request.status} ${request.statusText}`
            )
            if (!request.ok) {
                if (request.status >= 500) continue
                else break
            }
            if (request.status === 204) return
            const result = await request.json()
            if (result.data && !params?.raw) return result.data
            return result
        }
        throw new Error(
            `BigCommerce fetch error - ${(params?.method ?? 'get').toUpperCase()} ${request.status} ${
                request.statusText
            } ${await request.text()}`
        )
    }

    async get(endpoint: string, params?: FetchParameters) {
        return this.fetch(endpoint, { ...params, method: 'get' })
    }

    async getAll(endpoint: string, params?: FetchParameters) {
        const results = []
        let total_pages = 1
        for (let page = 1; page <= total_pages; page++) {
            const current: any = await this.fetch(endpoint, {
                ...params,
                queries: {
                    ...(params?.queries ?? {}),
                    page
                },
                raw: true
            })
            // v3 pagination
            if (current?.meta?.pagination?.total_pages)
                // TODO: Implement batchRequests to get remaining pages & exit loop early
                total_pages = current?.meta?.pagination?.total_pages
            // v2 pagination
            else if (current?.length === (params?.queries?.limit ?? 50)) total_pages++
            if (Array.isArray(current?.data ?? current))
                // @ts-ignore current || current.data is an array at this point
                results.push(...(current?.data ? current.data : current))
        }
        return results
    }

    async post(endpoint: string, params?: FetchParameters) {
        return this.fetch(endpoint, { ...params, method: 'post' })
    }

    async put(endpoint: string, params?: FetchParameters) {
        return this.fetch(endpoint, { ...params, method: 'put' })
    }

    async delete(endpoint: string, params?: FetchParameters) {
        return this.fetch(endpoint, { ...params, method: 'delete' })
    }

    /**
     * Make batches of requests for high concurrency
     * @param requests Requests to batch
     * @param concurrency Amount of concurrent request to make
     */
    async batchRequests(requests: (() => Promise<any>)[], concurrency: number) {
        const results: any[] = []
        const pages = Math.ceil(requests.length / concurrency)
        for (let page = 0; page < pages; page++) {
            console.log(`BATCH: ${page + 1}`)
            const i = page * concurrency
            results.push(...(await Promise.all(requests.slice(i, i + concurrency).map(request => request()))))
        }
        return results
    }
}
