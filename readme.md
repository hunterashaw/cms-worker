# Worker CMS

A minimal, headless CMS (with live preview) that can be effortlessly self-hosted on [Cloudflare Workers](https://workers.cloudflare.com/) for free.

[Live demo (read-only) here.](https://cms-worker.shaw-hunter-a.workers.dev/)

## Features

A full CRUD UI & API for:

-   :construction_worker: **Users**
    -   Built-in passwordless & API-token authentication
    -   Uses [Resend](https://resend.com/) for verification emails
-   :toolbox: **Models**
    -   Define your data using [JSON-schema](https://json-schema.org/)
    -   Live-preview data within your own websites/apps
    -   Build custom controllers to integrate with 3rd party systems (ecommerce, bloging, other 3rd party CMSs)
    -   Built on [Cloudflare D1](https://www.cloudflare.com/developer-platform/products/d1/)
-   :file_folder: **Files**
    -   Store any file for hosting
    -   Built on [Cloudflare R2](https://www.cloudflare.com/developer-platform/products/r2/)

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

-   Model `schema` must be an `object`
-   Objects
    -   Can have any `string` / `number` / `boolean` / `array` / `object` properties
    -   Properties can have `title`s and `description`s for annotation
    -   Properties can also have a `default` value
-   Strings
    -   Can have optional `'date-time'` or `'markdown'` `format`
-   Arrays
    -   Can only have an `object` or `{ anyof: ObjectSchema[] }` (for block-style content) `items`

> All document data is **loosely typed**. Object structure is built during editing as-needed to allow for flexibility. Always use optional chaining (?.) to access properties of document data.

### Markdown Editor

String properties with the `format: 'markdown'`, will display using the [MDX Editor](https://mdxeditor.dev/) with a set of plugins for basic formatting, creating links and uploading images.

### Live Preview

Models can implement live-preview by defining a function (`previewURL?: (document: { model: string; name: string; value: any }) => string | undefined`) that returns the preview URL to load within an iframe.

Real-time changes to the document will be pushed to the iframe using `window.postMessage`. Take a look at `public/test.html` for a plain Javascript example. This can easily be adapted to use React hooks within your own websites / apps.

### Custom Model Controllers

Custom controllers can be defined within the `const controllers` in `worker.ts`, where the key is the model name.

Any model name that doesn't match with a key will use the `default` controller, which just persists the document to the D1 database.

This can be used to integrate the CMS with 3rd party systems like ecommerce platforms. Custom controllers can be combined with the default controller to persist/combine data in both 3rd party systems & the D1 database.

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

-   [x] Dynamic model schema (accept schema generator function)
-   [x] Session device fingerprinting (IP + user agent hash)
-   [ ] Import/export CSV & JSON files within client
-   [ ] Document versions (change merging)
-   [ ] Caching (w/ invalidation)
-   [ ] User roles w/ granular permissions (including document versions)
-   [x] Rich text editor
-   [x] Custom mapped array item titles
-   [x] Folders
-   [x] Allow turning off creates, renames, updates & deletes within schema
-   [ ] Re-implement document references properly
