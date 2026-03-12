/**
 * Form Validation Service
 * Comprehensive validation for all forms to prevent invalid data
 */

class FormValidator {
    constructor() {
        this.rules = {};
    }

    /**
     * Validate a positive number
     */
    isPositiveNumber(value) {
        const num = parseFloat(value);
        return !isNaN(num) && num > 0;
    }

    /**
     * Validate a non-negative number
     */
    isNonNegativeNumber(value) {
        const num = parseFloat(value);
        return !isNaN(num) && num >= 0;
    }

    /**
     * Validate email format
     */
    isValidEmail(email) {
        if (!email || email.trim() === '') return true; // Optional field
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }

    /**
     * Validate phone number
     */
    isValidPhone(phone) {
        if (!phone || phone.trim() === '') return true; // Optional field
        const re = /^[\d\s\-\+\(\)]+$/;
        return phone.length >= 10 && re.test(phone);
    }

    /**
     * Validate percentage (0-100)
     */
    isValidPercentage(value) {
        const num = parseFloat(value);
        return !isNaN(num) && num >= 0 && num <= 100;
    }

    /**
     * Validate date
     */
    isValidDate(dateStr) {
        if (!dateStr) return false;
        const date = new Date(dateStr);
        return !isNaN(date.getTime());
    }

    /**
     * Validate date is not in the future
     */
    isNotFutureDate(dateStr) {
        const date = new Date(dateStr);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        return date <= today;
    }

    /**
     * Validate required field
     */
    isRequired(value) {
        if (value === null || value === undefined) return false;
        if (typeof value === 'string') return value.trim() !== '';
        return true;
    }

    /**
     * Validate minimum length
     */
    hasMinLength(value, minLength) {
        return value && value.length >= minLength;
    }

    /**
     * Validate expense form
     */
    validateExpenseForm(formData) {
        const errors = [];

        if (!this.isRequired(formData.date)) {
            errors.push('Date is required');
        } else if (!this.isValidDate(formData.date)) {
            errors.push('Invalid date format');
        }

        if (!this.isRequired(formData.description)) {
            errors.push('Description is required');
        }

        if (!this.isRequired(formData.category)) {
            errors.push('Category is required');
        }

        if (!this.isRequired(formData.amount)) {
            errors.push('Amount is required');
        } else if (!this.isPositiveNumber(formData.amount)) {
            errors.push('Amount must be a positive number');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validate sale form
     */
    validateSaleForm(formData) {
        const errors = [];

        if (!this.isRequired(formData.date)) {
            errors.push('Date is required');
        }

        if (!this.isRequired(formData.customer)) {
            errors.push('Customer name is required');
        }

        if (!this.isRequired(formData.productId)) {
            errors.push('Product must be selected');
        }

        if (!this.isRequired(formData.quantity)) {
            errors.push('Quantity is required');
        } else if (!this.isPositiveNumber(formData.quantity)) {
            errors.push('Quantity must be a positive number');
        }

        if (!this.isRequired(formData.price)) {
            errors.push('Price is required');
        } else if (!this.isPositiveNumber(formData.price)) {
            errors.push('Price must be a positive number');
        }

        if (formData.discount && !this.isValidPercentage(formData.discount)) {
            errors.push('Discount must be between 0 and 100');
        }

        if (formData.tax && !this.isNonNegativeNumber(formData.tax)) {
            errors.push('Tax must be a non-negative number');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validate product form
     */
    validateProductForm(formData) {
        const errors = [];

        if (!this.isRequired(formData.name)) {
            errors.push('Product name is required');
        }

        if (!this.isRequired(formData.category)) {
            errors.push('Category is required');
        }

        if (!this.isRequired(formData.cost)) {
            errors.push('Cost price is required');
        } else if (!this.isNonNegativeNumber(formData.cost)) {
            errors.push('Cost price must be a valid number');
        }

        if (!this.isRequired(formData.price)) {
            errors.push('Selling price is required');
        } else if (!this.isPositiveNumber(formData.price)) {
            errors.push('Selling price must be a positive number');
        }

        if (formData.quantity !== undefined && !this.isNonNegativeNumber(formData.quantity)) {
            errors.push('Quantity must be a non-negative number');
        }

        if (formData.minStock !== undefined && !this.isNonNegativeNumber(formData.minStock)) {
            errors.push('Minimum stock must be a non-negative number');
        }

        // Validate price > cost for profitability
        if (this.isPositiveNumber(formData.cost) && this.isPositiveNumber(formData.price)) {
            if (parseFloat(formData.price) < parseFloat(formData.cost)) {
                errors.push('Warning: Selling price is lower than cost price');
            }
        }

        return {
            isValid: errors.length === 0,
            errors: errors,
            warnings: errors.filter(e => e.startsWith('Warning:'))
        };
    }

    /**
     * Validate supplier form
     */
    validateSupplierForm(formData) {
        const errors = [];

        if (!this.isRequired(formData.name)) {
            errors.push('Supplier name is required');
        }

        if (!this.isRequired(formData.phone)) {
            errors.push('Phone number is required');
        } else if (!this.isValidPhone(formData.phone)) {
            errors.push('Invalid phone number format');
        }

        if (formData.email && !this.isValidEmail(formData.email)) {
            errors.push('Invalid email format');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validate customer form
     */
    validateCustomerForm(formData) {
        const errors = [];

        if (!this.isRequired(formData.name)) {
            errors.push('Customer name is required');
        }

        if (formData.email && !this.isValidEmail(formData.email)) {
            errors.push('Invalid email format');
        }

        if (formData.phone && !this.isValidPhone(formData.phone)) {
            errors.push('Invalid phone number format');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validate liability form
     */
    validateLiabilityForm(formData) {
        const errors = [];

        if (!this.isRequired(formData.type)) {
            errors.push('Liability type is required');
        }

        if (!this.isRequired(formData.creditor)) {
            errors.push('Creditor is required');
        }

        if (!this.isRequired(formData.description)) {
            errors.push('Description is required');
        }

        if (!this.isRequired(formData.amount)) {
            errors.push('Amount is required');
        } else if (!this.isPositiveNumber(formData.amount)) {
            errors.push('Amount must be a positive number');
        }

        if (!this.isRequired(formData.balance)) {
            errors.push('Current balance is required');
        } else if (!this.isNonNegativeNumber(formData.balance)) {
            errors.push('Balance must be a non-negative number');
        }

        if (!this.isRequired(formData.dueDate)) {
            errors.push('Due date is required');
        } else if (!this.isValidDate(formData.dueDate)) {
            errors.push('Invalid due date');
        }

        if (formData.interestRate && !this.isNonNegativeNumber(formData.interestRate)) {
            errors.push('Interest rate must be a non-negative number');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Validate payment form
     */
    validatePaymentForm(formData) {
        const errors = [];

        if (!this.isRequired(formData.amount)) {
            errors.push('Payment amount is required');
        } else if (!this.isPositiveNumber(formData.amount)) {
            errors.push('Payment amount must be a positive number');
        }

        if (!this.isRequired(formData.date)) {
            errors.push('Payment date is required');
        } else if (!this.isValidDate(formData.date)) {
            errors.push('Invalid payment date');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }

    /**
     * Display validation errors
     */
    showErrors(errors, containerId = null) {
        if (containerId) {
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = errors.map(e => 
                    `<div class="validation-error"><i class="fas fa-exclamation-circle"></i> ${e}</div>`
                ).join('');
                container.style.display = errors.length > 0 ? 'block' : 'none';
            }
        }

        // Also show toast for first error
        if (errors.length > 0) {
            import('../utils/utils.js').then(module => {
                module.Utils.showToast(errors[0], 'error');
            });
        }
    }

    /**
     * Setup real-time validation for form inputs
     */
    setupRealtimeValidation(formId, rules) {
        const form = document.getElementById(formId);
        if (!form) return;

        Object.entries(rules).forEach(([fieldId, validation]) => {
            const field = document.getElementById(fieldId);
            if (!field) return;

            field.addEventListener('blur', () => {
                const value = field.value;
                const result = validation.validate(value);
                
                field.classList.remove('input-error', 'input-success');
                field.classList.add(result.isValid ? 'input-success' : 'input-error');
                
                // Show inline error
                let errorSpan = field.parentNode.querySelector('.field-error');
                if (!errorSpan) {
                    errorSpan = document.createElement('span');
                    errorSpan.className = 'field-error';
                    field.parentNode.appendChild(errorSpan);
                }
                errorSpan.textContent = result.isValid ? '' : result.message;
            });
        });
    }
}

export const formValidator = new FormValidator();
window.formValidator = formValidator;
