const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function getToken() {
  console.log('🔑 Get Authentication Token\n');

  const email = await question('Enter your email: ');
  const password = await question('Enter your password: ');

  try {
    const response = await axios.post('http://localhost:5000/api/auth/login', {
      email,
      password
    });

    console.log('\n✅ Login successful!');
    console.log('\nYour token:');
    console.log(response.data.token);
    console.log('\n📋 Copy this token and use it to test the API');
    console.log('\nTo test the V2 API, run:');
    console.log(`TEST_TOKEN="${response.data.token}" node test-v2-api.js`);

  } catch (error) {
    console.error('\n❌ Login failed:');
    console.error(error.response?.data?.error || error.message);
  }

  rl.close();
}

getToken();
