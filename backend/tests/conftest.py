import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./data/test_course_replay.db"
os.environ["ARTIFACTS_DIR"] = "./data/test_artifacts"
os.environ["OPENAI_API_KEY"] = ""
os.environ["OPENAI_CHAT_MODEL"] = ""

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_data():
    yield
    engine.dispose()
    Path("data/test_course_replay.db").unlink(missing_ok=True)
