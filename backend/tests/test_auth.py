def register(client, username="hq", password="secret123", display_name="", headers=None):
    return client.post(
        "/api/auth/register",
        json={"username": username, "password": password, "display_name": display_name},
        headers=headers,
    )


def auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def test_register_login_me_and_logout(client):
    created = register(client, "HQ_Ching", display_name="HQ")
    assert created.status_code == 201
    body = created.json()
    assert body["user"]["username"] == "hq_ching"
    assert body["user"]["display_name"] == "HQ"

    # Username is case-insensitive at login; a fresh token is issued.
    login = client.post("/api/auth/login", json={"username": "hq_ching", "password": "secret123"})
    assert login.status_code == 200
    token = login.json()["token"]
    assert token != body["token"]

    me = client.get("/api/auth/me", headers=auth_header(token))
    assert me.status_code == 200
    assert me.json()["username"] == "hq_ching"

    assert client.post("/api/auth/logout", headers=auth_header(token)).status_code == 204
    assert client.get("/api/auth/me", headers=auth_header(token)).status_code == 401
    # The other session is still valid.
    assert client.get("/api/auth/me", headers=auth_header(body["token"])).status_code == 200


def test_rejects_duplicate_username_and_bad_password(client):
    assert register(client, "alice").status_code == 201
    assert register(client, "Alice").status_code == 409
    wrong = client.post("/api/auth/login", json={"username": "alice", "password": "nope-nope"})
    assert wrong.status_code == 401
    assert client.post("/api/auth/login", json={"username": "ghost", "password": "secret123"}).status_code == 401


def test_validates_registration_input(client):
    assert register(client, "a").status_code == 422  # too short
    assert register(client, "has space").status_code == 422
    assert register(client, "bob", password="123").status_code == 422


def test_rename_display_name(client):
    token = register(client, "carol").json()["token"]
    renamed = client.patch("/api/auth/me", json={"display_name": "  小卡  "}, headers=auth_header(token))
    assert renamed.status_code == 200
    assert renamed.json()["display_name"] == "小卡"
    assert client.patch("/api/auth/me", json={"display_name": "   "}, headers=auth_header(token)).status_code == 422


def test_requires_valid_token(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers=auth_header("forged")).status_code == 401
    assert client.get("/api/workspace").status_code == 401
