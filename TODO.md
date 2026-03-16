# WebToEpub Header Spoofing Task - CORS Proxy Origin Spoof

## Steps:
- [x] 1. Create TODO.md with plan steps
- [x] 2. Edit plugin/js/HttpClient.js to add Origin: http://localhost:8080 header for corsproxy.io proxy requests
- [x] 3. Test the change (reload extension/popup, enable corsproxy.io, check Network tab)
- [x] 4. Update TODO.md with completion and attempt_completion

**All steps complete.**  
Implemented header spoofing: Requests to https://corsproxy.io/?url= now include `Origin: http://localhost:8080` header, making the proxy think they originate from localhost.

