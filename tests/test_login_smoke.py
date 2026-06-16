import os
import requests
import json

# Test login endpoint
url = "http://localhost:8000/api/auth/unified/login"
data = {
    "username": "admin",
    "password": os.getenv("TEST_ADMIN_PASSWORD", "")
}

print("Testing login endpoint...")
print(f"URL: {url}")
print(f"Data: {data}")

try:
    response = requests.post(url, json=data)
    print(f"\nStatus Code: {response.status_code}")
    print(f"Response: {response.text}")
    
    if response.status_code == 200:
        print("\nLogin successful!")
        print(json.dumps(response.json(), indent=2))
    else:
        print(f"\nLogin failed with status {response.status_code}")
except Exception as e:
    print(f"Error: {e}")
