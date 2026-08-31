# foliON

공부 계획/기록 플래너. Vite + React, 데이터는 브라우저 localStorage에 저장됩니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
```

## GitHub에 올리기

```bash
git init
git add .
git commit -m "foliON initial commit"
git branch -M main
git remote add origin https://github.com/<사용자명>/<저장소명>.git
git push -u origin main
```

그 다음 Vercel 대시보드(https://vercel.com/new)에서 이 저장소를 Import 하면,
이후 GitHub에 push할 때마다 자동으로 재배포됩니다.

## 참고

- 데이터는 기기(브라우저)의 localStorage에만 저장됩니다. 다른 기기·다른 브라우저와는
  자동으로 동기화되지 않습니다.
