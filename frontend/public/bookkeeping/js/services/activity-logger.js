// ==================== ACTIVITY LOGGER SERVICE ====================

/**
 * Activity Logger
 * Logs user activities and provides audit trail
 */

import { addDoc, getDocs, query, orderBy, limit } from '../config/firebase.js';
import { firebaseService } from './firebase-service.js';
import { state } from '../utils/state.js';

class ActivityLogger {
            static async log(action, details) {
                try {
                    const activityData = {
                        action,
                        details,
                        timestamp: new Date().toISOString(),
                        user: state.currentUser?.email || 'Unknown'
                    };
                    
                    await addDoc(firebaseService.getUserCollection('activity_log'), activityData);
                } catch (error) {
                    console.error('Failed to log activity:', error);
                }
            }
            
            static async getRecentActivities(limitCount = 50) {
                try {
                    const snapshot = await getDocs(
                        query(
                            firebaseService.getUserCollection('activity_log'),
                            orderBy('timestamp', 'desc'),
                            limit(limitCount)
                        )
                    );
                    
                    const activities = [];
                    snapshot.forEach(doc => {
                        activities.push({ ...doc.data(), id: doc.id });
                    });
                    
                    return activities;
                } catch (error) {
                    console.error('Failed to load activities:', error);
                    return [];
                }
            }
        }

export default ActivityLogger;
