#!/usr/bin/env python3
"""
Backend API Testing for Enhanced Bookkeeping Firebase App
Tests AI endpoints and core functionality
"""

import requests
import json
import sys
from datetime import datetime

class BookkeepingAPITester:
    def __init__(self, base_url="https://realtime-data-lab.preview.emergentagent.com"):
        self.base_url = base_url
        self.tests_run = 0
        self.tests_passed = 0
        self.failed_tests = []

    def run_test(self, name, method, endpoint, expected_status, data=None, timeout=30):
        """Run a single API test"""
        url = f"{self.base_url}/{endpoint}"
        headers = {'Content-Type': 'application/json'}

        self.tests_run += 1
        print(f"\n🔍 Testing {name}...")
        print(f"   URL: {url}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == 'POST':
                print(f"   Data: {json.dumps(data, indent=2) if data else 'None'}")
                response = requests.post(url, json=data, headers=headers, timeout=timeout)

            success = response.status_code == expected_status
            if success:
                self.tests_passed += 1
                print(f"✅ PASSED - Status: {response.status_code}")
                try:
                    response_data = response.json() if response.text else {}
                    if response_data:
                        print(f"   Response preview: {str(response_data)[:200]}...")
                except:
                    print(f"   Response text: {response.text[:200]}...")
            else:
                print(f"❌ FAILED - Expected {expected_status}, got {response.status_code}")
                print(f"   Response: {response.text[:200]}...")
                self.failed_tests.append(f"{name}: Expected {expected_status}, got {response.status_code}")

            return success, response.json() if success and response.text else {}

        except requests.exceptions.Timeout:
            print(f"❌ FAILED - Request timeout ({timeout}s)")
            self.failed_tests.append(f"{name}: Timeout after {timeout}s")
            return False, {}
        except Exception as e:
            print(f"❌ FAILED - Error: {str(e)}")
            self.failed_tests.append(f"{name}: {str(e)}")
            return False, {}

    def test_health_check(self):
        """Test basic health endpoint"""
        return self.run_test("Health Check", "GET", "api/health", 200)

    def test_root_endpoint(self):
        """Test root API endpoint"""
        return self.run_test("Root Endpoint", "GET", "api/", 200)

    def test_ai_insights(self):
        """Test AI insights endpoint with sample data"""
        sample_data = {
            "sales_data": [
                {"product": "Laptop", "quantity": 5, "price": 1000, "date": "2024-12-20", "customer": "John Doe"},
                {"product": "Mouse", "quantity": 10, "price": 25, "date": "2024-12-20", "customer": "Jane Smith"},
                {"product": "Keyboard", "quantity": 8, "price": 75, "date": "2024-12-19", "customer": "Bob Johnson"}
            ],
            "expenses_data": [
                {"category": "Rent", "amount": 2000, "date": "2024-12-01", "description": "Office rent"},
                {"category": "Utilities", "amount": 300, "date": "2024-12-15", "description": "Electricity bill"}
            ],
            "products_data": [
                {"name": "Laptop", "quantity": 15, "cost": 800, "minStock": 5, "category": "Electronics"},
                {"name": "Mouse", "quantity": 50, "cost": 15, "minStock": 10, "category": "Accessories"},
                {"name": "Keyboard", "quantity": 2, "cost": 50, "minStock": 5, "category": "Accessories"}
            ],
            "period": "month",
            "analysis_type": "general"
        }
        
        success, response = self.run_test(
            "AI Insights (GPT-5.2)", 
            "POST", 
            "api/ai/insights", 
            200, 
            sample_data,
            timeout=60  # AI calls can be slow
        )
        
        if success and response:
            # Validate response structure
            required_fields = ['insights', 'recommendations', 'alerts']
            missing_fields = [field for field in required_fields if field not in response]
            if missing_fields:
                print(f"⚠️  Warning: Missing fields in response: {missing_fields}")
            else:
                print("✅ AI Insights response structure is valid")
                
        return success, response

    def test_ai_forecast(self):
        """Test AI forecast endpoint"""
        sample_data = {
            "historical_sales": [
                {"date": "2024-12-15", "total": 5000, "quantity": 15, "price": 100},
                {"date": "2024-12-16", "total": 3500, "quantity": 10, "price": 120},
                {"date": "2024-12-17", "total": 4200, "quantity": 12, "price": 110},
                {"date": "2024-12-18", "total": 6000, "quantity": 18, "price": 105},
                {"date": "2024-12-19", "total": 3800, "quantity": 11, "price": 115}
            ],
            "forecast_days": 30
        }
        
        success, response = self.run_test(
            "AI Sales Forecast", 
            "POST", 
            "api/ai/forecast", 
            200, 
            sample_data,
            timeout=60
        )
        
        if success and response:
            required_fields = ['predicted_daily_average', 'trend', 'confidence', 'forecast_period']
            missing_fields = [field for field in required_fields if field not in response]
            if missing_fields:
                print(f"⚠️  Warning: Missing fields in forecast response: {missing_fields}")
            else:
                print("✅ AI Forecast response structure is valid")
                
        return success, response

    def test_ai_chat(self):
        """Test AI chat endpoint"""
        sample_data = {
            "question": "What are the key metrics I should focus on to improve my business profitability?",
            "context": {
                "total_products": 25,
                "total_sales": 150,
                "period": "month",
                "revenue": 50000,
                "expenses": 15000
            }
        }
        
        success, response = self.run_test(
            "AI Business Chat", 
            "POST", 
            "api/ai/chat", 
            200, 
            sample_data,
            timeout=45
        )
        
        if success and response:
            if 'response' not in response:
                print("⚠️  Warning: Missing 'response' field in chat response")
            else:
                print("✅ AI Chat response structure is valid")
                
        return success, response

    def test_status_endpoints(self):
        """Test status creation and retrieval"""
        # Test creating status
        create_data = {
            "client_name": f"test_client_{datetime.now().strftime('%H%M%S')}"
        }
        
        success, response = self.run_test(
            "Create Status Check", 
            "POST", 
            "api/status", 
            200, 
            create_data
        )
        
        if success:
            # Test retrieving status
            success2, response2 = self.run_test(
                "Get Status Checks", 
                "GET", 
                "api/status", 
                200
            )
            return success2, response2
        
        return success, response

    def run_all_tests(self):
        """Run complete test suite"""
        print("=" * 60)
        print("🧪 Enhanced Bookkeeping Backend API Test Suite")
        print("=" * 60)
        
        # Basic connectivity tests
        print("\n📡 Testing Basic Connectivity...")
        self.test_health_check()
        self.test_root_endpoint()
        
        # Status endpoints
        print("\n📊 Testing Status Endpoints...")
        self.test_status_endpoints()
        
        # AI-powered features (main focus)
        print("\n🤖 Testing AI-Powered Features...")
        self.test_ai_insights()
        self.test_ai_forecast()
        self.test_ai_chat()
        
        # Print summary
        print("\n" + "=" * 60)
        print("📋 TEST SUMMARY")
        print("=" * 60)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed / self.tests_run * 100):.1f}%")
        
        if self.failed_tests:
            print("\n❌ Failed Tests:")
            for test in self.failed_tests:
                print(f"   • {test}")
        else:
            print("\n✅ All tests passed!")
        
        print("=" * 60)
        
        return self.tests_passed == self.tests_run

def main():
    """Main test execution"""
    tester = BookkeepingAPITester()
    success = tester.run_all_tests()
    
    return 0 if success else 1

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)