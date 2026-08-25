from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import hints, optimise, execute, moderate, solve, review_problem, community, projects

app = FastAPI(title="PseudocodeTutor API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(hints.router)
app.include_router(optimise.router)
app.include_router(execute.router)
app.include_router(moderate.router)
app.include_router(solve.router)
app.include_router(review_problem.router)
app.include_router(community.router)
app.include_router(projects.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
