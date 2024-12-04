drop table if exists users;
drop table if exists sessions;
drop table if exists documents;
drop table if exists files;
drop table if exists prefixes;

create table users (email text primary key, key text, verification text, verification_expires_at number);
create unique index users_key on users (key);
insert into users (email, verification, verification_expires_at) values ('admin@example.com', '1234', 1919887442);

create table sessions (key text primary key, email text, expires_at integer);

create table documents (path text, name text, value text, blob blob, created_at integer, modified_at integer, modified_by text);
create unique index documents_path on documents (path, name);
create index new_documents on documents (path, modified_at);

create table folders (path text, name text);
create unique index folders_path on folders (path, name);