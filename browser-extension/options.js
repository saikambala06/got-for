const DEFAULT='https://got-for.vercel.app';
const input=document.getElementById('apiBase'); const msg=document.getElementById('msg');
chrome.storage.sync.get(['apiBase']).then(({apiBase})=>{input.value=apiBase||DEFAULT;});
document.getElementById('saveBtn').addEventListener('click',async()=>{const value=input.value.trim().replace(/\/$/,'');if(!/^https?:\/\//i.test(value)){msg.textContent='Enter a valid http(s) URL.';return;}await chrome.storage.sync.set({apiBase:value});msg.textContent='Saved. The extension will use this portal on the next request.';});
