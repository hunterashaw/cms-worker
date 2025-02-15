import React from 'react'
import { Model } from './components/app'
import { FileIcon, ProductsIcon } from './components/icons'

export const models: Model[] = [
    {
        name: 'pages',
        singularName: 'page',
        icon: <FileIcon />,
        schema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'short, SEO-friendly page title' },
                description: { type: 'string' },
                content: { type: 'string', format: 'markdown' },
            },
        },
        previewURL: () => {
            return 'test'
        },
        nameAlias: 'path',
        folderAlias: 'status',
        folderPluralAlias: 'statuses',
    },
    {
        name: 'products',
        singularName: 'product',
        icon: <ProductsIcon />,
        schema: {
            type: 'object',
            properties: {
                name: { type: 'string' },
                description: { type: 'string', format: 'markdown' },
                price: { type: 'number' },
                wasPrice: { type: 'number', title: 'original price', description: 'optional' },
                variants: {
                    type: 'array',
                    itemKey: value => value?.sku,
                    itemDescription: value => value?.options?.map(option => `${option?.name}: ${option?.value}`)?.join(', '),
                    items: {
                        title: 'variant',
                        type: 'object',
                        properties: {
                            sku: { type: 'string' },
                            price: {
                                type: 'number',
                                description: 'optional price override',
                            },
                            options: {
                                type: 'array',
                                items: {
                                    title: 'option',
                                    type: 'object',
                                    properties: {
                                        name: { type: 'string' },
                                        value: { type: 'string' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        previewURL: () => {
            return 'test'
        },
        folderAlias: 'category',
        folderPluralAlias: 'categories',
    },
]
