import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from app.api import analysis


def test_topology_branch_and_merge(client, monkeypatch):
    monkeypatch.setattr(analysis, 'get_settings', lambda: SimpleNamespace(ai_configured=True))
    edges = [dict(source=a, target=b, reason='Material evidence') for a, b in [('a', 'b'), ('a', 'c'), ('b', 'd'), ('c', 'd')]]
    monkeypatch.setattr(analysis.AIProvider, 'chat', AsyncMock(return_value=json.dumps({'edges': edges})))
    nodes = [dict(id=i, title=i, tier='core', content='lecture') for i in 'abcd']
    response = client.post('/api/study/topology', json={'nodes': nodes})
    assert response.status_code == 200
    assert response.json()['edges'] == edges


def test_topology_rejects_cycle(client, monkeypatch):
    monkeypatch.setattr(analysis, 'get_settings', lambda: SimpleNamespace(ai_configured=True))
    edges = [dict(source=a, target=b, reason='Evidence') for a, b in [('a', 'b'), ('b', 'a')]]
    monkeypatch.setattr(analysis.AIProvider, 'chat', AsyncMock(return_value=json.dumps({'edges': edges})))
    nodes = [dict(id=i, title=i, tier='core', content='lecture') for i in 'ab']
    assert client.post('/api/study/topology', json={'nodes': nodes}).status_code == 502


def test_topology_requires_configuration(client):
    assert client.post('/api/study/topology', json={'nodes': [dict(id='a', title='a', tier='core', content='lecture')]}).status_code == 503
