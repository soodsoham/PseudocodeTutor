# PseudocodeTutor

React/Vite frontend plus a FastAPI backend. Supabase provides authentication and persistent data; Gemini provides hints, moderation, and generated solutions.

> Copyright © 2026 Soham Sood. All rights reserved. This repository is publicly
> viewable for educational and portfolio evaluation only; reuse or redistribution
> requires prior written permission. See [LICENSE](LICENSE).

## Restore the Supabase project

The old configured Supabase project no longer resolves. Create a new project in the Supabase dashboard, then:

1. Open **SQL Editor**, paste `supabase/migrations/001_initial_schema.sql`, and run it once.
2. In **Authentication → URL Configuration**, set the Site URL to `http://127.0.0.1:5173` for local development and add your eventual production frontend URL to Redirect URLs.
3. Email/password auth works without another provider. For Google login, enable Google under **Authentication → Providers** and configure its client ID and secret.
4. From **Project Settings → API**, copy the project URL, publishable/anon key, and service-role key.
5. Update `frontend/.env.local` with the URL and anon key. Update `backend/.env` with the URL and service-role key. Never put the service-role key in the frontend.
6. Set `VITE_ADMIN_EMAIL` in `frontend/.env.local`, and replace the matching admin-email placeholder in the SQL migration before running it.

Use `.env.example` in each app as the key list. Restart both servers after changing env files.

## Run locally

Backend (terminal 1):

```bash
cd backend
python3 -m venv venv
./venv/bin/python -m pip install -r requirements.txt
./venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Frontend (terminal 2):

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5173>. Check the API at <http://127.0.0.1:8000/health>.

## Verification

```bash
cd frontend && npm run build
curl http://127.0.0.1:8000/health
curl 'http://127.0.0.1:8000/community/problems?board=cie-igcse&limit=5'
```

The backend Dockerfile already uses Python 3.12. For local development, prefer Python 3.12 as well; the old checked-in virtualenv is Python 3.9 and now emits end-of-life warnings.

The Gemini model is configurable with `GEMINI_MODEL` and defaults to `gemini-2.5-flash`. This replaces the retired model names previously hard-coded in several routes.
