"""Core API coverage for app info, health, and status create/list flow."""

from datetime import datetime


class TestCoreAPI:
    def test_app_info(self, api_client, base_url):
        response = api_client.get(f"{base_url}/api/")
        assert response.status_code == 200

        data = response.json()
        assert data["name"] == "Memory Capsule"
        assert data["mode"] == "local-first"
        assert data["assistant_available"] is False
        assert data["payments_enabled"] is False

    def test_health(self, api_client, base_url):
        response = api_client.get(f"{base_url}/api/health")
        assert response.status_code == 200

        data = response.json()
        assert data["status"] == "ok"
        assert data["service"] == "memory-capsule-api"
        assert isinstance(data["timestamp"], str)

    def test_create_status_and_verify_in_list(self, api_client, base_url):
        payload = {"client_name": "TEST_memory_capsule_client"}
        create_response = api_client.post(f"{base_url}/api/status", json=payload)
        assert create_response.status_code == 200

        created = create_response.json()
        assert created["client_name"] == payload["client_name"]
        assert isinstance(created["id"], str)
        assert created["id"]
        assert isinstance(created["timestamp"], str)

        list_response = api_client.get(f"{base_url}/api/status")
        assert list_response.status_code == 200

        items = list_response.json()
        assert isinstance(items, list)
        assert any(item.get("id") == created["id"] for item in items)

        matched = next(item for item in items if item.get("id") == created["id"])
        assert matched["client_name"] == payload["client_name"]
        datetime.fromisoformat(matched["timestamp"].replace("Z", "+00:00"))
