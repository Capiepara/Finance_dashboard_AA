# Albert & Annie – Personal Finance Dashboard

Web tĩnh chạy trực tiếp trên GitHub Pages, không cần cài Node.js.

## Chạy thử trên máy

Vì trình duyệt chặn đọc CSV khi mở bằng `file://`, hãy chạy một web server nhỏ:

```bash
python -m http.server 8000
```

Sau đó mở `http://localhost:8000`.

## Đưa lên GitHub Pages

1. Tạo repository mới trên GitHub.
2. Upload toàn bộ nội dung thư mục này vào nhánh `main`.
3. Vào **Settings → Pages**.
4. Chọn **Deploy from a branch**.
5. Chọn nhánh `main`, thư mục `/root`, rồi Save.

## Kết nối Google Sheets

Mở `app.js`, tìm:

```js
googleSheetCsvUrl: null,
```

Đổi thành:

```js
googleSheetCsvUrl: 'https://docs.google.com/spreadsheets/d/1gAr4O_sTA6L68ThUHqcrmiruMe2aP_Oh39khKwVcOt8/export?format=csv&gid=1116776327',
```

Google Sheet phải cho phép **Anyone with the link – Viewer** hoặc được Publish to web.

## Cấu trúc CSV được hỗ trợ

Dashboard tự tìm dòng tiêu đề, nên vẫn đọc được file có vài dòng trang trí phía trên. Các cột cần có:

- Month
- Date
- Actual
- Type
- Category
- Items
- Amount
- Description

## Ngân sách hiện tại

Trong `app.js`:

```js
totalExpenseBudget: 19_000_000,
categoryBudgets: { Meal: 4_000_000, Unexpected: 1_000_000 },
```

## Phân bổ tiết kiệm

- Investment: 15%
- Kids: 10%
- Education: 25%
- Emergency: 20%
- Saving: 30%
