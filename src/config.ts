import { Model } from './components/app'

export const rootFolders: string[] = ['pages']

export const models: Model[] = [
    {
        path: 'pages',
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                description: { type: 'string', format: 'markdown' },
                content: {
                    description: 'drag & drop to re-order content blocks.',
                    type: 'array',
                    items: {
                        anyOf: [
                            {
                                title: 'Hero',
                                type: 'object',
                                properties: {
                                    title: { type: 'string' },
                                    sub_title: { type: 'string', title: 'sub title' },
                                    image: { type: 'string', format: 'uri', model: 'files' },
                                },
                                default: { title: 'Hero Block', sub_title: 'Hero block description text.' },
                            },
                            {
                                title: 'Value Proposition',
                                type: 'object',
                                properties: {
                                    values: {
                                        type: 'array',
                                        items: {
                                            title: 'Value Proposition Item',
                                            type: 'object',
                                            properties: {
                                                title: { type: 'string' },
                                                sub_title: { type: 'string', title: 'sub title' },
                                            },
                                            default: { title: 'Value', sub_title: 'Value description text.' },
                                        },
                                    },
                                },
                                default: {},
                            },
                        ],
                    },
                },
            },
        },
        previewURL: product => {
            return '/test'
        },
    },
]
