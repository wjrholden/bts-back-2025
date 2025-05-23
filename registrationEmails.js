const nodemailer = require('nodemailer');
const EMAIL_PASS = process.env.EMAIL_PASS;
const TICKETING_APP_URL = process.env.TICKETING_APP_URL;

const sendEmailConfirmation = async (email, context, token) => {
  // Set up the transporter object using your email provider's SMTP server
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'updates@bustoshow.org',
      pass: EMAIL_PASS
    }
  });

  // Define the email options
  const mailOptions = {
    from: 'updates@bustoshow.org',
    to: email,
    subject: context === 'confirm' ? 'Bus to Show Email Confirmation' : 'Bus to Show Password Reset',
    text: context === 'confirm'
      ? `Thank you for registering! Please click the following link to confirm your email address: ${TICKETING_APP_URL}/verify/${token}`
      : `A password reset was requested for this account. Please click the following link to continue: ${TICKETING_APP_URL}/reset/${token}`
  };

  // Send the email
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent', info);
  } catch (error) {
    console.error('Email not sent', error);
  }
}

module.exports = {sendEmailConfirmation}
