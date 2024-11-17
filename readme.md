# Worker CMS

A minimal, headless CMS (with live preview) that can be effortlessly self-hosted on [Cloudflare Workers](https://workers.cloudflare.com/) for free.

[Live demo (read-only) here.](https://cms-worker.shaw-hunter-a.workers.dev/)

## Features

A full CRUD UI & API for:

- :construction_worker: **Users**
    - Built-in passwordless & API-token authentication
    - Uses [Resend](https://resend.com/) for verification emails
- :toolbox: **Models**
    - Define your data using [JSON-schema](https://json-schema.org/)
    - Reference other documents/files/users within your schema
    - Live-preview data within your own websites/apps
    - Build custom controllers to integrate with 3rd party systems (ecommerce, bloging, other 3rd party CMSs)
    - Built on [Cloudflare D1](https://www.cloudflare.com/developer-platform/products/d1/)
- :file_folder: **Files**
    - Store any file for hosting / referencing within your data
    - Built on [Cloudflare R2](https://www.cloudflare.com/developer-platform/products/r2/)

## Setup

Download the `.zip` file above (Code > Download Zip).

Create a new git repository & install the dependencies within the unzipped directory by running:

```bash
git init && npm i
```

Create database tables by running:

```bash
npm run migrate
```

Start the project at [http://localhost:3000](http://localhost:3000) by running:

```bash
npm start
```

> Check the local worker logs for user verification during development.

## Configuration & Development

### Schema

Models are defined within `src/config.ts`.

Model schema accepts a restricted set of [JSON-schema](https://json-schema.org/) using the following rules:

 - Model `schema` must be an `object`
 - Objects
    - Can have any `string` / `number` / `boolean` / `array` / `object` properties
    - Properties can have `title`s and `description`s for annotation
    - Properties can also have a `default` value
 - Strings
    - Can have optional `'date-time'` or `'uri'` `format`
    - References to other documents/files/users are implemented using `format: 'uri', model: modelName` where `modelName` is either `'files'`, `'users'`, or any other model name
 - Arrays
    - Can only have an `object` `items` type
    - Can also have an `{ anyof: ObjectSchema[] }` `items` type for 'block-style' content

> All document data is **loosely typed**. Object structure is built during editing as-needed to allow for flexibility. Always use optional chaining (?.) to access properties of document data.

### Live Preview

Models can implement live-preview by defining a function (`previewURL?: (document: { model: string; name: string; value: any }) => string | undefined`) that returns the preview URL to load within an iframe.

Real-time changes to the document will be pushed to the iframe using `window.postMessage`. Take a look at `public/test.html` for a plain Javascript example. This can easily be adapted to use React hooks within your own websites / apps.

### Custom Model Controllers

Custom controllers can be defined within the `const controllers` in `worker.ts`, where the key is the model name.

Any model name that doesn't match with a key will use the `default` controller, which just persists the document to the D1 database.

This can be used to integrate the CMS with 3rd party systems like ecommerce platforms. Custom controllers can be combined with the default controller to persist/combine data in both 3rd party systems & the D1 database.

See `controllers/products.ts` for an example controller that integrates with the BigCommerce Catalog API (note that a compatible schema is also required).

### Development

All backend related functionality starts from `worker.ts`.

All frontend related functionality starts from `components/app.tsx`.

## Deploying

Update `wrangler.toml` with your Cloudflare account ID, R2 bucket, D1 database ID & Resend API key.

Deploy the CMS to production by running:

```bash
npm run deploy
```

## Feature Roadmap

- [x] Dynamic model schema (accept schema generator function)
- [ ] Session device fingerprinting (IP + user agent hash)
- [ ] Import/export CSV & JSON files within client
- [ ] Document versions (change merging)
- [ ] Pre-built React hooks for live preview (new module?)
- [ ] Caching (w/ invalidation)
- [ ] User roles w/ granular permissions (including document versions)
- [ ] Rich text editor
- [ ] Custom mapped array item titles