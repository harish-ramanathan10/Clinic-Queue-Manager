
// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyCHjP0JWdv2ndyFTiHE8XVxhdfzRKf7seM",
  authDomain: "clinic-queue-manager-28de5.firebaseapp.com",
  projectId: "clinic-queue-manager-28de5",
  storageBucket: "clinic-queue-manager-28de5.firebasestorage.app",
  messagingSenderId: "251920408420",
  appId: "1:251920408420:web:afd3554f6f789b2b37a471",
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Global State
let currentClinic = null;
let currentRoomForDoctor = null;
let currentRoomForSwap = null;
let unsubscribeRooms = null;
let unsubscribeQueue = null;
let unsubscribeNotifications = null;
let updateInterval = null;

// Cache for reducing reads
let cachedRooms = [];
let cachedQueue = [];
let isProcessingAutomation = false;

// Twilio Configuration
const TWILIO_ENDPOINT = "/.netlify/functions/send-sms";

// ============================================
// INITIALIZATION
// ============================================

window.addEventListener('load', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const clinicId = urlParams.get('clinic');
    
    if (clinicId) {
        showMobileAddPatient(clinicId);
    } else {
        loadClinics();
        checkAutoLogin();
    }
    
    setupEventListeners();
});

function setupEventListeners() {
    document.getElementById('createAccountBtn').addEventListener('click', createAccount);
    document.getElementById('backToLoginBtn').addEventListener('click', showLogin);
    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('showAddAccountBtn').addEventListener('click', showAddAccount);
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('patientLinkBtn').addEventListener('click', showPatientLink);
    document.getElementById('addPatientBtn').addEventListener('click', addPatient);
    document.getElementById('addPatientMobileBtn').addEventListener('click', addPatientFromMobile);
    
    document.getElementById('closeSettingsBtn').addEventListener('click', closeSettings);
    document.getElementById('numRooms').addEventListener('change', updateRoomCount);
    document.getElementById('addDoctorBtn').addEventListener('click', addDoctor);
    
    document.getElementById('closeLinkBtn').addEventListener('click', closeLinkModal);
    document.getElementById('closeAssignBtn').addEventListener('click', closeAssignDoctor);
    document.getElementById('closeSwapBtn').addEventListener('click', closeSwap);
    document.getElementById('saveRoomDoctorsBtn').addEventListener('click', saveRoomDoctors);
    document.getElementById('copyLinkBtn').addEventListener('click', copyPatientLink);
}

// ============================================
// AUTHENTICATION
// ============================================

function showAddAccount() {
    document.getElementById('addAccountScreen').style.display = 'block';
    document.getElementById('loginScreen').style.display = 'none';
}

function showLogin() {
    document.getElementById('addAccountScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'block';
    loadClinics();
}

async function loadClinics() {
    const select = document.getElementById('clinicSelect');
    select.innerHTML = '<option value="">-- Select Clinic --</option>';
    
    try {
        const snapshot = await db.collection('clinics').get();
        snapshot.forEach(doc => {
            const clinic = doc.data();
            const opt = document.createElement('option');
            opt.value = doc.id;
            opt.textContent = clinic.name;
            select.appendChild(opt);
        });
    } catch (error) {
        alert('Error loading clinics');
    }
}

async function createAccount() {
    const name = document.getElementById('newClinicName').value.trim();
    const pass1 = document.getElementById('newPassword1').value;
    const pass2 = document.getElementById('newPassword2').value;

    if (!name || !pass1 || !pass2) {
        alert('Please fill all fields');
        return;
    }

    if (pass1 !== pass2) {
        alert('Passwords do not match');
        return;
    }

    try {
        const existing = await db.collection('clinics')
            .where('name', '==', name)
            .get();
        
        if (!existing.empty) {
            alert('Clinic name already exists');
            return;
        }

        const baseUrl = window.location.origin + window.location.pathname;
        const clinicRef = await db.collection('clinics').add({
            name,
            password: btoa(pass1),
            doctors: [],
            numRooms: 4,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        const clinicId = clinicRef.id;
        await clinicRef.update({
            patientLink: `${baseUrl}?clinic=${clinicId}`
        });

        const roomsRef = db.collection('clinics').doc(clinicId).collection('rooms');
        for (let i = 0; i < 4; i++) {
            await roomsRef.add({
                id: i,
                name: `Room ${i + 1}`,
                state: 'available',
                assignedDoctors: ['Any Doctor'],
                patient: null,
                timerStart: null,
                order: i
            });
        }

        alert('Account created successfully!');
        document.getElementById('newClinicName').value = '';
        document.getElementById('newPassword1').value = '';
        document.getElementById('newPassword2').value = '';
        showLogin();
    } catch (error) {
        alert('Error creating account');
    }
}

function checkAutoLogin() {
    const savedClinicId = sessionStorage.getItem('clinicId');
    if (savedClinicId) {
        db.collection('clinics').doc(savedClinicId).get()
            .then(doc => {
                if (doc.exists) {
                    currentClinic = { id: doc.id, ...doc.data() };
                    showDashboard();
                }
            });
    }
}

async function login() {
    const clinicId = document.getElementById('clinicSelect').value;
    const password = document.getElementById('loginPassword').value;

    if (!clinicId || !password) {
        alert('Please select clinic and enter password');
        return;
    }

    try {
        const doc = await db.collection('clinics').doc(clinicId).get();
        
        if (!doc.exists) {
            alert('Clinic not found');
            return;
        }

        const clinic = doc.data();
        if (atob(clinic.password) !== password) {
            alert('Invalid password');
            return;
        }

        currentClinic = { id: doc.id, ...clinic };
        sessionStorage.setItem('clinicId', clinicId);
        showDashboard();
    } catch (error) {
        alert('Login failed');
    }
}

async function logout() {
    if (!currentClinic) return;

    try {
        const clinicId = currentClinic.id;
        
        const queueSnapshot = await db.collection('clinics').doc(clinicId)
            .collection('queue').get();
        const queueDeletes = queueSnapshot.docs.map(doc => doc.ref.delete());
        await Promise.all(queueDeletes);

        const notifSnapshot = await db.collection('clinics').doc(clinicId)
            .collection('notifications').get();
        const notifDeletes = notifSnapshot.docs.map(doc => doc.ref.delete());
        await Promise.all(notifDeletes);

        const roomsSnapshot = await db.collection('clinics').doc(clinicId)
            .collection('rooms').get();
        const roomUpdates = roomsSnapshot.docs.map(doc => 
            doc.ref.update({
                state: 'available',
                patient: null,
                timerStart: null
            })
        );
        await Promise.all(roomUpdates);

        if (unsubscribeRooms) unsubscribeRooms();
        if (unsubscribeQueue) unsubscribeQueue();
        if (unsubscribeNotifications) unsubscribeNotifications();
        if (updateInterval) clearInterval(updateInterval);

        sessionStorage.removeItem('clinicId');
        currentClinic = null;

        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
        document.getElementById('loginPassword').value = '';
    } catch (error) {
        alert('Logout error');
    }
}

// ============================================
// MOBILE PATIENT ADDITION
// ============================================

async function showMobileAddPatient(clinicId) {
    try {
        const doc = await db.collection('clinics').doc(clinicId).get();
        
        if (!doc.exists) {
            alert('Clinic not found');
            return;
        }

        const clinic = { id: doc.id, ...doc.data() };
        currentClinic = clinic;

        document.getElementById('addAccountScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'none';
        document.getElementById('mobileAddPatient').style.display = 'block';
        
        document.getElementById('mobileClinicName').textContent = clinic.name;
        
        const mobileSelect = document.getElementById('mobileDoctorSelect');
        mobileSelect.innerHTML = '<option value="Any Doctor">Any Doctor</option>';
        (clinic.doctors || []).forEach(doc => {
            const opt = document.createElement('option');
            opt.value = doc;
            opt.textContent = doc;
            mobileSelect.appendChild(opt);
        });
    } catch (error) {
        alert('Error loading clinic information');
    }
}

// ============================================
// DASHBOARD
// ============================================

function showDashboard() {
    document.getElementById('addAccountScreen').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('mobileAddPatient').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';

    initializeDashboard();
    setupRealtimeListeners();
    
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(() => {
        renderRooms();
        renderQueue();
        processAutomation();
    }, 1000);
}

async function initializeDashboard() {
    try {
        const doc = await db.collection('clinics').doc(currentClinic.id).get();
        currentClinic = { id: doc.id, ...doc.data() };
        
        updateDoctorDropdowns();
    } catch (error) {
        alert('Error initializing dashboard');
    }
}

function setupRealtimeListeners() {
    const clinicId = currentClinic.id;

    unsubscribeRooms = db.collection('clinics').doc(clinicId)
        .collection('rooms')
        .orderBy('order')
        .onSnapshot(snapshot => {
            cachedRooms = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));
        });

    unsubscribeQueue = db.collection('clinics').doc(clinicId)
        .collection('queue')
        .orderBy('addedTime')
        .onSnapshot(snapshot => {
            cachedQueue = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() }));
        });

    unsubscribeNotifications = db.collection('clinics').doc(clinicId)
        .collection('notifications')
        .orderBy('timestamp', 'desc')
        .limit(20)
        .onSnapshot(snapshot => {
            renderNotifications();
        });
}

function updateDoctorDropdowns() {
    const selects = [
        document.getElementById('patientDoctor'),
        document.getElementById('mobileDoctorSelect')
    ];

    selects.forEach(select => {
        if (select) {
            select.innerHTML = '<option value="Any Doctor">Any Doctor</option>';
            (currentClinic.doctors || []).forEach(doc => {
                const opt = document.createElement('option');
                opt.value = doc;
                opt.textContent = doc;
                select.appendChild(opt);
            });
        }
    });
}

// Replace the GEMINI section in app.js with this:

// ============================================
// GEMINI INTEGRATION - SECURE WITH NETLIFY FUNCTIONS
// ============================================

const GEMINI_ENDPOINT = "/.netlify/functions/get-duration";

async function getPredictedDuration(reason) {
  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason })
    });

    if (!response.ok) {
      console.warn("Gemini function failed → fallback used");
      return 7;
    }

    const data = await response.json();
    return data.duration || 7;

  } catch (error) {
    console.warn("Gemini request failed → fallback used", error);
    return 7;
  }
}


// ============================================
// ADD PATIENT FUNCTIONS
// ============================================

async function addPatient() {
    const name = document.getElementById('patientName').value.trim();
    const phone = document.getElementById('patientPhone').value.trim();
    const doctor = document.getElementById('patientDoctor').value;
    const reason = document.getElementById('patientReason').value.trim();

    if (!name || !phone || !reason) {
        alert('Please fill all required fields');
        return;
    }

    const btn = document.getElementById('addPatientBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Getting AI prediction...';
    btn.disabled = true;

    try {
        const duration = await getPredictedDuration(reason);
        
        btn.textContent = 'Saving to queue...';
        
        await db.collection('clinics').doc(currentClinic.id)
            .collection('queue').add({
                name,
                phone,
                doctor,
                reason,
                addedTime: firebase.firestore.FieldValue.serverTimestamp(),
                predictedDuration: duration,
                advancedNotificationSent: false,
                immediateNotificationSent: false
            });

        document.getElementById('patientName').value = '';
        document.getElementById('patientPhone').value = '';
        document.getElementById('patientReason').value = '';
        document.getElementById('patientDoctor').value = 'Any Doctor';

        setTimeout(() => processAutomation(), 100);
    } catch (error) {
        alert('Failed to get AI prediction. Please check your internet connection and try again.');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function addPatientFromMobile() {
    const name = document.getElementById('mobilePatientName').value.trim();
    const phone = document.getElementById('mobilePhone').value.trim();
    const doctor = document.getElementById('mobileDoctorSelect').value;
    const reason = document.getElementById('mobileReason').value.trim();

    if (!name || !phone || !reason) {
        alert('Please fill all fields');
        return;
    }

    const btn = document.getElementById('addPatientMobileBtn');
    const originalText = btn.textContent;
    btn.textContent = 'Getting AI prediction...';
    btn.disabled = true;

    try {
        const duration = await getPredictedDuration(reason);
        
        btn.textContent = 'Saving to queue...';
        
        await db.collection('clinics').doc(currentClinic.id)
            .collection('queue').add({
                name,
                phone,
                doctor,
                reason,
                addedTime: firebase.firestore.FieldValue.serverTimestamp(),
                predictedDuration: duration,
                advancedNotificationSent: false,
                immediateNotificationSent: false
            });

        document.getElementById('mobilePatientName').value = '';
        document.getElementById('mobilePhone').value = '';
        document.getElementById('mobileReason').value = '';
        document.getElementById('mobileDoctorSelect').value = 'Any Doctor';

    } catch (error) {
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

// ============================================
// ROOM RENDERING & MANAGEMENT
// ============================================

function renderRooms() {
    if (!currentClinic) return;

    const grid = document.getElementById('roomsGrid');
    if (!grid) return;

    const rooms = cachedRooms;
    grid.innerHTML = '';

    rooms.forEach(room => {
        const card = document.createElement('div');
        card.className = `room-card ${room.state}`;
        
        let content = `
            <div class="room-header">
                <div class="room-name">${room.name}</div>
                <div class="room-status status-${room.state}">
                    ${room.state.charAt(0).toUpperCase() + room.state.slice(1)}
                </div>
            </div>
            <div class="room-doctor" onclick="window.openAssignDoctor('${room.docId}')">
                🩺 ${room.assignedDoctors.join(', ')}
            </div>
        `;

        if (room.state === 'available') {
            // NO buttons for available state
        } else if (room.patient) {
            content += `
                <div class="room-patient-info">
                    <div><strong>${room.patient.name}</strong></div>
                    <div>Doctor: ${room.patient.doctor}</div>
                    <div>Reason: ${room.patient.reason}</div>
                    <div style="font-size: 12px; color: #9ca3af;">Duration: ${room.patient.predictedDuration} min</div>
                </div>
                <div class="room-timer">${getTimerDisplay(room)}</div>
                <div class="timer-label">${room.state === 'reserved' ? 'TIME WAITING' : 'TIME REMAINING'}</div>
                ${getActionButtons(room)}
            `;
        }

        card.innerHTML = content;
        grid.appendChild(card);
    });
}

function getTimerDisplay(room) {
    if (!room.timerStart) return '0:00';

    const startTime = room.timerStart.toMillis ? room.timerStart.toMillis() : room.timerStart;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    
    if (room.state === 'reserved') {
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    } else if (room.state === 'occupied' && room.patient) {
        const remaining = room.patient.predictedDuration * 60 - elapsed;
        if (remaining <= 0) return '0:00';
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    return '0:00';
}

function getActionButtons(room) {
    if (room.state === 'reserved') {
        return `
            <div class="room-actions">
                <button class="room-btn btn-here" onclick="window.markHere('${room.docId}')">Here</button>
                <button class="room-btn btn-cancel" onclick="window.cancelReservation('${room.docId}')">Cancel</button>
                <button class="room-btn btn-swap" onclick="window.openSwap('${room.docId}')">Swap</button>
            </div>
        `;
    }
    
    if (room.state === 'occupied') {
        return `
            <div class="room-actions">
                <button class="room-btn btn-complete" onclick="window.completeAppointment('${room.docId}')">Complete</button>
            </div>
        `;
    }
    return '';
}

window.markHere = async function(roomDocId) {
    try {
        await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .doc(roomDocId)
            .update({
                state: 'occupied',
                timerStart: firebase.firestore.FieldValue.serverTimestamp()
            });
    } catch (error) {
        alert('Error marking here');
    }
};

window.cancelReservation = async function(roomDocId) {
    try {
        await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .doc(roomDocId)
            .update({
                state: 'available',
                patient: null,
                timerStart: null
            });
    } catch (error) {
        alert('Error canceling reservation');
    }
};

window.completeAppointment = async function(roomDocId) {
    try {
        await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .doc(roomDocId)
            .update({
                state: 'available',
                patient: null,
                timerStart: null
            });

        setTimeout(() => processAutomation(), 100);
    } catch (error) {
        alert('Error completing appointment');
    }
};

// ============================================
// QUEUE RENDERING
// ============================================

function renderQueue() {
    if (!currentClinic) return;

    const queueList = document.getElementById('queueList');
    const queueCount = document.getElementById('queueCount');
    
    if (!queueList || !queueCount) return;

    const queue = cachedQueue;
    
    queueCount.textContent = `${queue.length} waiting`;

    if (queue.length === 0) {
        if (queueList.innerHTML !== '<div class="notification-empty">No patients in queue</div>') {
            queueList.innerHTML = '<div class="notification-empty">No patients in queue</div>';
        }
        return;
    }

    const currentHTML = queueList.innerHTML;
    let newHTML = '';

    for (let i = 0; i < queue.length; i++) {
        const patient = queue[i];
        const addedTime = patient.addedTime?.toDate ? patient.addedTime.toDate() : new Date(patient.addedTime);
        
        newHTML += `
            <div class="queue-card">
                <div class="queue-position">#${i + 1} ${patient.name}</div>
                <div class="queue-detail">Doctor: ${patient.doctor}</div>
                <div class="queue-detail">${patient.reason}</div>
                <div class="queue-detail">${addedTime.toLocaleTimeString()} · ${patient.predictedDuration} min est.</div>
            </div>
        `;
    }

    if (currentHTML !== newHTML) {
        queueList.innerHTML = newHTML;
    }
}


// ============================================
// PATIENT-ROOM MATCHING LOGIC - CORRECTED
// ============================================

function canPatientGoToRoom(patient, room) {
    console.log(`Checking: Patient "${patient.name}" (${patient.doctor}) → Room "${room.name}" (${room.assignedDoctors.join(', ')})`);
    
    // Patient with "Any Doctor"
    if (patient.doctor === 'Any Doctor') {
        // Can go to "Any Doctor" rooms OR specific doctor rooms
        const canGo = room.assignedDoctors.includes('Any Doctor') || 
                      (room.assignedDoctors.length > 0 && !room.assignedDoctors.includes('Any Doctor'));
        console.log(`  → Any Doctor patient: ${canGo ? '✓ CAN' : '✗ CANNOT'} go`);
        return canGo;
    }
    
    // Patient with specific doctor
    // Can ONLY go to rooms with that specific doctor
    // CANNOT go to "Any Doctor" rooms
    if (room.assignedDoctors.includes('Any Doctor')) {
        console.log(`  → Specific doctor patient to Any Doctor room: ✗ CANNOT go`);
        return false;
    }
    
    const canGo = room.assignedDoctors.includes(patient.doctor);
    console.log(`  → Specific doctor patient: ${canGo ? '✓ CAN' : '✗ CANNOT'} go`);
    return canGo;
}

// ============================================
// AUTOMATION & NOTIFICATIONS - FIXED
// ============================================

async function processAutomation() {
    if (!currentClinic || isProcessingAutomation) return;

    isProcessingAutomation = true;
    
    try {
        await checkAdvancedNotifications();
        await autoFillAvailableRooms();
        await autoCompleteExpiredRooms();
    } catch (error) {
        console.error('Automation error:', error);
    } finally {
        isProcessingAutomation = false;
    }
}

async function autoFillAvailableRooms() {
    const rooms = cachedRooms.filter(r => r.state === 'available');
    const queue = cachedQueue;

    if (rooms.length === 0 || queue.length === 0) return;

    // Process ONE patient at a time to prevent double-assignment
    for (const patient of queue) {
        // Find first compatible available room
        const compatibleRoom = rooms.find(room => {
            // Make sure room is still available
            const currentRoom = cachedRooms.find(r => r.docId === room.docId);
            return currentRoom && currentRoom.state === 'available' && canPatientGoToRoom(patient, room);
        });

        if (compatibleRoom) {
            try {
                console.log(`🔄 Auto-assigning ${patient.name} to ${compatibleRoom.name}`);
                
                const roomRef = db.collection('clinics').doc(currentClinic.id)
                    .collection('rooms').doc(compatibleRoom.docId);

                await roomRef.update({
                    patient: {
                        id: patient.docId,
                        name: patient.name,
                        phone: patient.phone,
                        doctor: patient.doctor,
                        reason: patient.reason,
                        predictedDuration: patient.predictedDuration || 15
                    },
                    state: 'reserved',
                    timerStart: firebase.firestore.FieldValue.serverTimestamp()
                });

                await db.collection('clinics').doc(currentClinic.id)
                    .collection('queue').doc(patient.docId).delete();

                await sendNotification(patient, 'immediate', compatibleRoom.name, patient.docId);
                
                // Remove this room from available rooms so it's not reused
                const roomIndex = rooms.findIndex(r => r.docId === compatibleRoom.docId);
                if (roomIndex !== -1) {
                    rooms.splice(roomIndex, 1);
                }
                
                console.log(`✓ Successfully assigned ${patient.name} to ${compatibleRoom.name}`);
            } catch (error) {
                console.error('Error auto-filling room:', error);
            }
        }
    }
}

async function autoCompleteExpiredRooms() {
    const rooms = cachedRooms.filter(r => r.state === 'occupied');

    for (const room of rooms) {
        if (room.patient && room.timerStart) {
            const startTime = room.timerStart.toMillis ? room.timerStart.toMillis() : room.timerStart;
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = (room.patient.predictedDuration * 60) - elapsed;
            
            if (remaining <= 0) {
                await db.collection('clinics').doc(currentClinic.id)
                    .collection('rooms')
                    .doc(room.docId)
                    .update({
                        state: 'available',
                        patient: null,
                        timerStart: null
                    });
            }
        }
    }
}

async function checkAdvancedNotifications() {
    const rooms = cachedRooms.filter(r => r.state === 'occupied');
    const queue = cachedQueue;

    let roomsAboutToFinish = [];
    
    for (const room of rooms) {
        if (room.patient && room.timerStart) {
            const startTime = room.timerStart.toMillis ? room.timerStart.toMillis() : room.timerStart;
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const remaining = (room.patient.predictedDuration * 60) - elapsed;
            
            if (remaining > 0 && remaining <= 300) {
                roomsAboutToFinish.push(room);
            }
        }
    }

    if (roomsAboutToFinish.length === 0) return;

    let notified = 0;
    
    for (const patient of queue) {
        if (notified >= roomsAboutToFinish.length) break;
        
        if (patient.advancedNotificationSent) continue;
        
        const compatibleRoom = roomsAboutToFinish.find(r => canPatientGoToRoom(patient, r));
        
        if (compatibleRoom) {
            await sendNotification(patient, 'advanced', null, patient.docId);
            await db.collection('clinics').doc(currentClinic.id)
                .collection('queue').doc(patient.docId)
                .update({ advancedNotificationSent: true });
            notified++;
        }
    }
}

async function sendNotification(patient, type, roomName, patientId) {
    try {
        const existing = await db.collection('clinics').doc(currentClinic.id)
            .collection('notifications')
            .where('patientId', '==', patientId)
            .where('type', '==', type)
            .get();

        if (!existing.empty) return;

        let message = '';
        if (type === 'immediate') {
            message = `Please proceed to ${roomName}`;
        } else if (type === 'advanced') {
            message = 'You will be called within 5 minutes';
        }

        await db.collection('clinics').doc(currentClinic.id)
            .collection('notifications').add({
                patientId,
                patientName: patient.name,
                phone: patient.phone,
                type,
                message,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

        console.log(`📧 Sending ${type} SMS to ${patient.phone}: ${message}`);

        try {
            const response = await fetch(TWILIO_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    to: patient.phone,
                    message: `${currentClinic.name}: ${message}`
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ SMS failed:', errorText);
            } else {
                const result = await response.json();
                console.log('✓ SMS sent successfully:', result.messageSid);
            }
        } catch (error) {
            console.error('SMS sending error:', error);
        }
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}

async function renderNotifications() {
    if (!currentClinic) return;

    const list = document.getElementById('notificationsList');
    if (!list) return;

    try {
        const snapshot = await db.collection('clinics').doc(currentClinic.id)
            .collection('notifications')
            .orderBy('timestamp', 'desc')
            .limit(5)
            .get();

        if (snapshot.empty) {
            list.innerHTML = '<div class="notification-empty">No notifications sent yet</div>';
            return;
        }

        list.innerHTML = '';
        snapshot.forEach(doc => {
            const notif = doc.data();
            const timestamp = notif.timestamp?.toDate ? notif.timestamp.toDate() : new Date();
            
            const card = document.createElement('div');
            card.className = `notification-card ${notif.type}`;
            card.innerHTML = `
                <div><strong>${notif.patientName}</strong></div>
                <div>${notif.type === 'immediate' ? 'Immediate' : 'Advanced'} · ${notif.message}</div>
                <div style="font-size: 12px; color: #9ca3af; margin-top: 4px;">
                    ${timestamp.toLocaleTimeString()}
                </div>
            `;
            list.appendChild(card);
        });
    } catch (error) {
        console.error('Error rendering notifications:', error);
    }
}

// ============================================
// SETTINGS
// ============================================

function openSettings() {
    document.getElementById('numRooms').value = currentClinic.numRooms || 4;
    renderDoctorList();
    document.getElementById('settingsModal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

async function updateRoomCount() {
    const num = parseInt(document.getElementById('numRooms').value);
    if (num < 1 || num > 10) return;

    try {
        await db.collection('clinics').doc(currentClinic.id).update({
            numRooms: num
        });

        currentClinic.numRooms = num;

        const roomsSnapshot = await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .orderBy('order')
            .get();

        const currentRoomCount = roomsSnapshot.size;

        if (num > currentRoomCount) {
            for (let i = currentRoomCount; i < num; i++) {
                await db.collection('clinics').doc(currentClinic.id)
                    .collection('rooms').add({
                        id: i,
                        name: `Room ${i + 1}`,
                        state: 'available',
                        assignedDoctors: ['Any Doctor'],
                        patient: null,
                        timerStart: null,
                        order: i
                    });
            }
        } else if (num < currentRoomCount) {
            const roomsToDelete = roomsSnapshot.docs.slice(num);
            for (const doc of roomsToDelete) {
                const room = doc.data();
                if (room.state === 'available') {
                    await doc.ref.delete();
                }
            }
        }
    } catch (error) {
        console.error('Error updating room count:', error);
    }
}

async function addDoctor() {
    const name = document.getElementById('newDoctorName').value.trim();
    if (!name) return;

    try {
        const doctors = currentClinic.doctors || [];
        if (!doctors.includes(name)) {
            doctors.push(name);
            await db.collection('clinics').doc(currentClinic.id).update({
                doctors
            });
            currentClinic.doctors = doctors;
            
            document.getElementById('newDoctorName').value = '';
            renderDoctorList();
            updateDoctorDropdowns();
        }
    } catch (error) {
        console.error('Error adding doctor:', error);
    }
}

async function removeDoctor(name) {
    try {
        const doctors = (currentClinic.doctors || []).filter(d => d !== name);
        await db.collection('clinics').doc(currentClinic.id).update({
            doctors
        });
        currentClinic.doctors = doctors;
        
        renderDoctorList();
        updateDoctorDropdowns();
    } catch (error) {
        console.error('Error removing doctor:', error);
    }
}

window.removeDoctor = removeDoctor;

function renderDoctorList() {
    const list = document.getElementById('doctorList');
    list.innerHTML = '';
    
    const doctors = currentClinic.doctors || [];
    
    if (doctors.length === 0) {
        list.innerHTML = '<div style="color: #9ca3af; text-align: center; padding: 20px;">No doctors added yet</div>';
        return;
    }
    
    doctors.forEach(doctor => {
        const item = document.createElement('div');
        item.className = 'doctor-item';
        item.innerHTML = `
            <span>${doctor}</span>
            <button class="doctor-remove" onclick="removeDoctor('${doctor}')">Remove</button>
        `;
        list.appendChild(item);
    });
}

// ============================================
// ROOM DOCTOR ASSIGNMENT
// ============================================

window.openAssignDoctor = async function(roomDocId) {
    currentRoomForDoctor = roomDocId;
    
    try {
        const roomDoc = await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .doc(roomDocId)
            .get();

        const room = roomDoc.data();
        
        document.getElementById('assignRoomName').textContent = room.name;
        
        const container = document.getElementById('doctorCheckboxes');
        container.innerHTML = '';
        
        const anyDiv = document.createElement('div');
        anyDiv.className = 'checkbox-item';
        anyDiv.innerHTML = `
            <input type="checkbox" id="doctor_any" value="Any Doctor" 
                ${room.assignedDoctors.includes('Any Doctor') ? 'checked' : ''}>
            <label for="doctor_any">Any Doctor</label>
        `;
        container.appendChild(anyDiv);
        
        (currentClinic.doctors || []).forEach((doctor, idx) => {
            const div = document.createElement('div');
            div.className = 'checkbox-item';
            div.innerHTML = `
                <input type="checkbox" id="doctor_${idx}" value="${doctor}" 
                    ${room.assignedDoctors.includes(doctor) ? 'checked' : ''}>
                <label for="doctor_${idx}">${doctor}</label>
            `;
            container.appendChild(div);
        });
        
        document.getElementById('assignDoctorModal').style.display = 'flex';
    } catch (error) {
        console.error('Error opening assign doctor:', error);
    }
};

function closeAssignDoctor() {
    document.getElementById('assignDoctorModal').style.display = 'none';
    currentRoomForDoctor = null;
}

async function saveRoomDoctors() {
    try {
        const checkboxes = document.querySelectorAll('#doctorCheckboxes input[type="checkbox"]:checked');
        let selected = Array.from(checkboxes).map(cb => cb.value);
        
        if (selected.length === 0) {
            selected = ['Any Doctor'];
        }
        
        if (selected.includes('Any Doctor')) {
            selected = ['Any Doctor'];
        }
        
        await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .doc(currentRoomForDoctor)
            .update({
                assignedDoctors: selected
            });

        closeAssignDoctor();
    } catch (error) {
        console.error('Error saving room doctors:', error);
    }
}

// ============================================
// SWAP FUNCTIONALITY
// ============================================

window.openSwap = async function(roomDocId) {
    currentRoomForSwap = roomDocId;
    
    try {
        const roomDoc = await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .doc(roomDocId)
            .get();

        const room = roomDoc.data();
        
        const queueSnapshot = await db.collection('clinics').doc(currentClinic.id)
            .collection('queue')
            .orderBy('addedTime')
            .get();

        const swapList = document.getElementById('swapPatientList');
        swapList.innerHTML = '';
        
        let hasCompatible = false;
        
        queueSnapshot.docs.forEach((doc, idx) => {
            const patient = doc.data();
            
            if (canPatientGoToRoom(patient, room)) {
                hasCompatible = true;
                const card = document.createElement('div');
                card.className = 'queue-card';
                card.innerHTML = `
                    <div class="queue-position">#${idx + 1}</div>
                    <div class="queue-name">${patient.name}</div>
                    <div class="queue-detail">Doctor: ${patient.doctor}</div>
                    <div class="queue-detail">Reason: ${patient.reason}</div>
                `;
                card.onclick = () => performSwap(doc.id);
                swapList.appendChild(card);
            }
        });
        
        if (!hasCompatible) {
            swapList.innerHTML = '<div class="notification-empty">No compatible patients in queue</div>';
        }
        
        document.getElementById('swapModal').style.display = 'flex';
    } catch (error) {
        console.error('Error opening swap:', error);
    }
};

async function performSwap(queueDocId) {
    try {
        const roomDoc = await db.collection('clinics').doc(currentClinic.id)
            .collection('rooms')
            .doc(currentRoomForSwap)
            .get();

        const room = roomDoc.data();
        const currentPatient = room.patient;
        
        const newPatientDoc = await db.collection('clinics').doc(currentClinic.id)
            .collection('queue')
            .doc(queueDocId)
            .get();

        const newPatient = newPatientDoc.data();
        
        await db.collection('clinics').doc(currentClinic.id)
            .collection('queue').add({
                name: currentPatient.name,
                phone: currentPatient.phone,
                doctor: currentPatient.doctor,
                reason: currentPatient.reason,
                predictedDuration: currentPatient.predictedDuration,
                addedTime: firebase.firestore.Timestamp.fromMillis(Date.now() - 1000000),
                advancedNotificationSent: false,
                immediateNotificationSent: false
            });

        await newPatientDoc.ref.delete();

        await roomDoc.ref.update({
            patient: {
                id: queueDocId,
                name: newPatient.name,
                phone: newPatient.phone,
                doctor: newPatient.doctor,
                reason: newPatient.reason,
                predictedDuration: newPatient.predictedDuration || 15
            },
            state: 'reserved',
            timerStart: firebase.firestore.FieldValue.serverTimestamp()
        });

        await sendNotification(newPatient, 'immediate', room.name, queueDocId);
        
        closeSwap();
    } catch (error) {
        console.error('Error performing swap:', error);
    }
}

function closeSwap() {
    document.getElementById('swapModal').style.display = 'none';
    currentRoomForSwap = null;
}

// ============================================
// PATIENT LINK
// ============================================

function showPatientLink() {
    document.getElementById('patientLinkInput').value = currentClinic.patientLink;
    document.getElementById('linkModal').style.display = 'flex';
}

function closeLinkModal() {
    document.getElementById('linkModal').style.display = 'none';
}

function copyPatientLink() {
    const link = currentClinic.patientLink;
    navigator.clipboard.writeText(link).then(() => {
        alert('Link copied to clipboard!');
    }).catch(() => {
        const input = document.getElementById('patientLinkInput');
        input.select();
        document.execCommand('copy');
        alert('Link copied!');
    });
}







