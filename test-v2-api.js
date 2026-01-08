const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

// You'll need to replace this with your actual token
// Get it from your browser localStorage after logging in
const TOKEN = process.env.TEST_TOKEN || 'YOUR_TOKEN_HERE';

const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json'
  }
});

async function testV2API() {
  console.log('🧪 Testing V2 API Endpoints\n');
  console.log('='.repeat(50));

  try {
    // Test 1: Check if we're authenticated
    console.log('\n1️⃣ Testing Authentication...');
    const meResponse = await api.get('/api/me');
    console.log('✅ Authenticated as:', meResponse.data.user.email);
    console.log('   GitHub Connected:', !!meResponse.data.user.github);

    if (!meResponse.data.user.github) {
      console.log('❌ GitHub not connected. Please connect GitHub first.');
      return;
    }

    // Test 2: Import a repository
    console.log('\n2️⃣ Testing Import Repository...');
    console.log('   Enter a test repository (e.g., "octocat/Hello-World")');
    console.log('   Using: octocat/Hello-World');

    const importResponse = await api.post('/api/v2/projects/import', {
      repoFullName: 'octocat/Hello-World',
      branch: 'master'
    });

    console.log('✅ Project imported successfully!');
    console.log('   Project ID:', importResponse.data.project.id);
    console.log('   Name:', importResponse.data.project.name);
    console.log('   Branch:', importResponse.data.project.productionBranch);

    const projectId = importResponse.data.project.id;

    // Test 3: Get project details
    console.log('\n3️⃣ Testing Get Project...');
    const projectResponse = await api.get(`/api/v2/projects/${projectId}`);
    console.log('✅ Project details retrieved');
    console.log('   Project Type:', projectResponse.data.project.projectType);
    console.log('   Deployments:', projectResponse.data.project.deployments.length);

    // Test 4: Deploy the project
    console.log('\n4️⃣ Testing Deploy...');
    console.log('   Starting deployment...');

    const deployResponse = await api.post(`/api/v2/projects/${projectId}/deploy`, {
      deploymentType: 'PRODUCTION'
    });

    console.log('✅ Deployment started!');
    console.log('   Deployment ID:', deployResponse.data.deployment.id);
    console.log('   Status:', deployResponse.data.deployment.status);
    console.log('   Branch:', deployResponse.data.deployment.branch);
    console.log('   Commit:', deployResponse.data.deployment.commitHash.substring(0, 7));

    const deploymentId = deployResponse.data.deployment.id;

    // Test 5: Monitor deployment status
    console.log('\n5️⃣ Monitoring Deployment Status...');

    let status = 'QUEUED';
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    while (status !== 'READY' && status !== 'ERROR' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));

      const statusResponse = await api.get(`/api/v2/deployments/${deploymentId}`);
      const newStatus = statusResponse.data.deployment.status;

      if (newStatus !== status) {
        status = newStatus;
        console.log(`   Status: ${status}`);

        if (status === 'READY') {
          console.log('✅ Deployment completed!');
          console.log('   URL:', statusResponse.data.deployment.url);
          console.log('   Duration:', statusResponse.data.deployment.buildDuration, 'seconds');
        } else if (status === 'ERROR') {
          console.log('❌ Deployment failed');
          console.log('   Error:', statusResponse.data.deployment.errorMessage);
        }
      }

      attempts++;
    }

    if (attempts >= maxAttempts) {
      console.log('⏱️ Deployment still in progress after 30s');
    }

    // Test 6: Change branch
    console.log('\n6️⃣ Testing Change Branch...');
    const branchResponse = await api.post(`/api/v2/projects/${projectId}/change-branch`, {
      branch: 'master'
    });
    console.log('✅ Branch changed successfully');

    console.log('\n' + '='.repeat(50));
    console.log('✨ All tests completed successfully!');
    console.log('\nProject Dashboard:');
    console.log(`   Project ID: ${projectId}`);
    console.log(`   Latest Deployment: ${deploymentId}`);

  } catch (error) {
    console.error('\n❌ Test failed:');
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Error:', error.response.data.error || error.response.data);
    } else {
      console.error('   Error:', error.message);
    }
  }
}

// Run tests
testV2API().catch(console.error);
