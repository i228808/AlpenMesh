const axios = require('axios');

const API_URL = 'http://localhost:3000/api/auth';

const runTests = async () => {
    try {
        // 1. Register Admin
        console.log('1. Registering Admin...');
        const adminRes = await axios.post(`${API_URL}/register`, {
            username: 'adminUser',
            email: 'admin@test.com',
            password: 'password123',
            role: 'admin'
        });
        console.log('Admin Registered:', adminRes.data.email);
        const adminToken = adminRes.data.token;

        // 2. Register Basic User
        console.log('\n2. Registering Basic User...');
        const userRes = await axios.post(`${API_URL}/register`, {
            username: 'basicUser',
            email: 'user@test.com',
            password: 'password123',
            role: 'basic'
        });
        console.log('Basic User Registered:', userRes.data.email);
        const userToken = userRes.data.token;

        // 3. Login Admin (Verify Token)
        console.log('\n3. Logging in Admin...');
        const loginRes = await axios.post(`${API_URL}/login`, {
            email: 'admin@test.com',
            password: 'password123'
        });
        console.log('Admin Logged in, Token received.');

        // 4. Access Admin Route as Admin
        console.log('\n4. Accessing Admin Route as Admin...');
        const adminAccess = await axios.get(`${API_URL}/admin`, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log('Success:', adminAccess.data.message);

        // 5. Access Admin Route as Basic User (Should Fail)
        console.log('\n5. Accessing Admin Route as Basic User...');
        try {
            await axios.get(`${API_URL}/admin`, {
                headers: { Authorization: `Bearer ${userToken}` }
            });
        } catch (error) {
            console.log('Expected Error:', error.response.status, error.response.data.message);
        }

    } catch (error) {
        console.error('Test Failed:', error.response ? error.response.data : error.message);
    }
};

// Wait for server to start
setTimeout(runTests, 2000);
