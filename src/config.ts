import { Model } from './components/app'

export const models: Model[] = [
    {
        name: 'pages',
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string' },
                url: { type: 'string' },
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
                                    image: { type: 'string', format: 'uri', model: 'files' }
                                },
                                default: { title: 'Hero Block', sub_title: 'Hero block description text.' }
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
                                                sub_title: { type: 'string', title: 'sub title' }
                                            },
                                            default: { title: 'Value', sub_title: 'Value description text.' }
                                        }
                                    }
                                },
                                default: {}
                            }
                        ]
                    }
                }
            }
        },
        previewURL: product => {
            return '/test'
        }
    },
    {
        name: 'products',
        schema: {
            type: 'object',
            properties: {
                type: { type: 'string', enum: ['physical', 'digital'] },
                price: { type: 'number' },
                weight: { type: 'number' },
                custom_fields: {
                    type: 'array',
                    items: {
                        type: 'object',
                        title: 'custom field',
                        properties: { name: { type: 'string' }, value: { type: 'string' } },
                        default: {}
                    }
                }
            }
        },
        previewURL: product => {
            return '/test'
        }
    }
]
