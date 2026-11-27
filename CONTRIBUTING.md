# Contributing to Agam Paper Trading Platform

Thank you for your interest in contributing to **Agam Paper Trading**! We welcome and appreciate contributions of all kinds from developers, quants, traders, and designers worldwide.

This project is **100% Free & Open Source (MIT License)**. Anyone can use, modify, extend, and contribute to this repository.

---

## 🤝 How You Can Contribute

- **Report Bugs**: If you spot an issue, glitch, incorrect tax rate, or chart calculation error, open an issue on GitHub with reproduction steps.
- **Feature Requests**: Have an idea for a new indicator, custom chart type, order execution method, or market feed? Share your proposal!
- **Code Contributions**:
  - Add or improve technical indicators (`backend/core/quant.py`).
  - Expand country statutory tax rates (`backend/core/tax_brokerage.py`).
  - Add support for new exchange feeds and universes (`backend/core/universe_loader.py`).
  - Improve the Next.js / Tailwind UI/UX (`frontend/src/components/`).
  - Write unit and integration tests (`backend/tests/`).
- **Documentation**: Fix typos, add setup guides for different operating systems, or write educational guides on risk management and trading psychology.

---

## 🛠️ Development Setup & Workflow

### 1. Fork and Clone
```bash
git clone https://github.com/<your-username>/Agam-Paper-Trading.git
cd Agam-Paper-Trading
```

### 2. Create a Feature Branch
```bash
git checkout -b feature/your-feature-name
```

### 3. Setup Local Environment
```bash
# Backend setup
cd backend
pip install -r requirements.txt
cd ..

# Frontend setup
cd frontend
npm install
cd ..
```

### 4. Run the Dev Servers
```bash
python start_agam.py
```

### 5. Test Your Changes
- Ensure backend tests pass:
  ```bash
  python backend/tests/test_taxes_and_frontpage.py
  ```
- Ensure frontend compiles without TypeScript or build errors:
  ```bash
  cd frontend
  npm run build
  cd ..
  ```

### 6. Submit a Pull Request
- Push your branch to GitHub:
  ```bash
  git push origin feature/your-feature-name
  ```
- Open a Pull Request against the `main` branch with a clear title and description of your modifications.

---

## 📜 Code of Conduct & Principles

- **Zero Paid Dependencies**: We maintain a strict policy of using free, open, and accessible public financial data. Avoid introducing hard dependencies on paid API services.
- **Offline & Private**: User portfolio databases (`agam_platform.db`) must remain strictly local and private to the user's computer.
- **Maintainer Contact**: For any queries, reach out to Anirudh Janjirala at [anirudhjanjirala@gmail.com](mailto:anirudhjanjirala@gmail.com).
