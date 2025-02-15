drop table if exists users;
drop table if exists sessions;
drop table if exists documents;
drop table if exists cache;

create table users (
    email text primary key,
    key text,
    verification text,
    verification_expires_at number
) without rowid;
create unique index users_key on users (key);
insert into users (email, verification, verification_expires_at) values ('admin@example.com', '1234', 2000000000);

create table sessions (
    key text primary key,
    email text,
    expires_at integer
) without rowid;

create table documents (
    model text,
    folder text,
    name text,
    value text,
    modified_at integer,
    modified_by text,
    primary key (model, folder, name)
);
create index model_documents on documents (model, name);

create table cache (
    key text primary key,
    value text
);
