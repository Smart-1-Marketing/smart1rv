/**
 * Smart1 RV Lead Submission Handler
 */
async function postLead(event) {
    if (event) {
        event.preventDefault();
    }

    const submitBtn = document.querySelector('button[type="submit"]') || document.getElementById('submit-btn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerText = 'Generating Custom Report...';
    }

    // Extract form data safely
    const formData = {
        name: (document.getElementById('name') || {}).value || '',
        email: (document.getElementById('email') || {}).value || '',
        phone: (document.getElementById('phone') || {}).value || '',
        company: (document.getElementById('company') || document.getElementById('dealership') || {}).value || ''
    };

    const targetUrl = 'https://smart1rv.onrender.com/api/rv-demand/estimate-and-submit';

    try {
        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify(formData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server returned HTTP status ${response.status}: ${errorText}`);
        }

        const result = await response.json();

        // Safely validate client_pdf_url to prevent "Failed to parse URL from undefined"
        if (result && result.status === 'success' && result.client_pdf_url) {
            console.log('PDF Generated Successfully:', result.client_pdf_url);
            // Redirect to PDF download
            window.location.href = result.client_pdf_url;
        } else {
            console.error('Unexpected response payload structure:', result);
            alert('Your lead was recorded, but the report download link was missing. Please try again.');
        }

    } catch (error) {
        console.error('Error during lead submission:', error);
        alert('There was a temporary issue connecting to the report server. Please try submitting again.');
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerText = 'Submit & Get Free Audit';
        }
    }
}

// Bind event listener on page load
document.addEventListener('DOMContentLoaded', () => {
    const leadForm = document.getElementById('lead-form') || document.querySelector('form');
    if (leadForm) {
        leadForm.addEventListener('submit', postLead);
    }
});
