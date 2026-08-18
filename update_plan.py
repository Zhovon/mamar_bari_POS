import sys

def main():
    with open('/Users/biw/.gemini/antigravity-ide/brain/dab24719-83e6-4e8f-be7b-8f320d181cf3/implementation_plan.md', 'r') as f:
        content = f.read()

    new_section = """
### 5. MPOS & Manager Payment Workflow (Reprint Support)
- **Current Issue**: Printing shows the UI background, and the table automatically closes right after taking payment, meaning if the printer jams, the receipt is lost forever.
- **Fix Print Styling**: Ensure `@media print` correctly hides all UI elements and overrides background colors so only the monochrome receipt prints cleanly.
- **New Workflow**:
  1. Waiter takes payment. Order status becomes `Paid`.
  2. A new "Payment Successful" modal appears on screen instead of instantly closing the table.
  3. This modal has a "🖨️ Print Receipt" button, which can be pressed as many times as needed if the printer malfunctions.
  4. Once the receipt is physically printed perfectly, the waiter clicks "✅ Finish & Close Table", which finally sets the table status to `Completed`, ends the customer session, and clears the table.
"""
    
    # insert before "Verification Plan"
    content = content.replace("## Verification Plan", new_section + "\n## Verification Plan")

    with open('/Users/biw/.gemini/antigravity-ide/brain/dab24719-83e6-4e8f-be7b-8f320d181cf3/implementation_plan.md', 'w') as f:
        f.write(content)

if __name__ == '__main__':
    main()
