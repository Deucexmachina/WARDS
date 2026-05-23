from datetime import datetime, timedelta
from typing import List, Dict, Any

class AnomalyDetectionService:
    def __init__(self):
        pass
    
    def detect_unusual_transaction_volume(self, transactions: List[Dict[str, Any]]) -> Dict[str, Any]:
        if len(transactions) < 10:
            return {"anomaly_detected": False, "message": "Insufficient data"}
        
        hourly_counts = {}
        for txn in transactions:
            hour = txn.get('timestamp', datetime.now()).hour
            hourly_counts[hour] = hourly_counts.get(hour, 0) + 1
        
        # Simple average calculation without numpy
        count_values = list(hourly_counts.values())
        avg_count = sum(count_values) / len(count_values)
        current_count = hourly_counts.get(datetime.now().hour, 0)
        
        if current_count > avg_count * 1.5:
            return {
                "anomaly_detected": True,
                "type": "unusual_volume",
                "severity": "medium",
                "message": f"Transaction volume {int((current_count/avg_count - 1) * 100)}% higher than average",
                "current_count": current_count,
                "average_count": avg_count
            }
        
        return {"anomaly_detected": False}
    
    def detect_suspicious_login_attempts(self, login_attempts: List[Dict[str, Any]]) -> Dict[str, Any]:
        failed_attempts = {}
        
        for attempt in login_attempts:
            ip = attempt.get('ip_address')
            if not attempt.get('success', False):
                failed_attempts[ip] = failed_attempts.get(ip, 0) + 1
        
        for ip, count in failed_attempts.items():
            if count >= 5:
                return {
                    "anomaly_detected": True,
                    "type": "suspicious_login",
                    "severity": "high",
                    "message": f"Multiple failed login attempts from IP {ip}",
                    "ip_address": ip,
                    "attempt_count": count
                }
        
        return {"anomaly_detected": False}
    
    def detect_unusual_payment_pattern(self, payment_data: Dict[str, Any]) -> Dict[str, Any]:
        amount = payment_data.get('amount', 0)
        
        if amount > 1000000:
            return {
                "anomaly_detected": True,
                "type": "high_value_transaction",
                "severity": "medium",
                "message": f"Unusually high payment amount: ₱{amount:,.2f}",
                "amount": amount
            }
        
        return {"anomaly_detected": False}
    
    def analyze_system_behavior(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        response_time = metrics.get('response_time_ms', 0)
        error_rate = metrics.get('error_rate', 0)
        
        anomalies = []
        
        if response_time > 3000:
            anomalies.append({
                "type": "performance",
                "severity": "low",
                "message": f"Database response time exceeding threshold: {response_time}ms"
            })
        
        if error_rate > 0.05:
            anomalies.append({
                "type": "errors",
                "severity": "medium",
                "message": f"High error rate detected: {error_rate * 100:.1f}%"
            })
        
        if anomalies:
            return {
                "anomaly_detected": True,
                "anomalies": anomalies
            }
        
        return {"anomaly_detected": False}

anomaly_service = AnomalyDetectionService()
