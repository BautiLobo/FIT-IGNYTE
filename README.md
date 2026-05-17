#  Fit Ignite

Plataforma de gestión para negocio de comida saludable por suscripción.

## Stack

- **Next.js 15** (App Router)
- **TypeScript**
- **Tailwind CSS v4**
- **Supabase** (base de datos)

## Pantallas

- **Clientes** — alta, baja, modificación y búsqueda de clientes
- **Menú / Pedidos** — registrar pedidos por cliente y fecha; gestionar comidas disponibles
- **Pedidos del día** — vista de cocina agrupada por comida con notas

## Setup

### 1. Clonar e instalar

```bash
git clone https://github.com/TU_USUARIO/fit-ignite.git
cd fit-ignite
npm install
```

### 2. Variables de entorno

```bash
cp .env.local.example .env.local
```

Editá `.env.local` con tus credenciales de Supabase:

```
NEXT_PUBLIC_SUPABASE_URL=https://TU_PROYECTO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=TU_ANON_KEY
```

Las encontrás en tu proyecto de Supabase → **Settings → API**.

### 3. Crear tablas en Supabase

```sql
create table clientes (
  id bigint primary key generated always as identity,
  nombre text not null,
  tel text default '',
  dir text default '',
  plan text default 'Básico',
  comidas int default 0,
  notas text default '',
  created_at timestamptz default now()
);

create table comidas (
  id bigint primary key generated always as identity,
  nombre text not null unique
);

create table pedidos (
  id bigint primary key generated always as identity,
  cliente_id bigint references clientes(id) on delete cascade,
  fecha date not null,
  comida text not null,
  notas text default '',
  created_at timestamptz default now()
);
```

### 4. Correr en desarrollo

```bash
npm run dev
```

Abrí [http://localhost:3000](http://localhost:3000).

### 5. Deploy en Vercel

Conectá el repo desde [vercel.com](https://vercel.com), agregá las variables de entorno y listo.

## Estructura

```
src/
├── app/
│   ├── layout.tsx        # Layout con sidebar
│   ├── page.tsx          # Redirect a /clientes
│   ├── clientes/page.tsx
│   ├── pedidos/page.tsx
│   └── hoy/page.tsx
├── components/
│   ├── Sidebar.tsx
│   ├── Modal.tsx
│   └── ConfirmDialog.tsx
├── lib/
│   └── supabase.ts
└── types/
    └── index.ts
```
