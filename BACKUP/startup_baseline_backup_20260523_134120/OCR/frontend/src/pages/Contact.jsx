function Contact() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-gray-800 mb-6">Contact Us</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="card">
          <h2 className="text-2xl font-semibold text-primary-700 mb-4">Get In Touch</h2>
          <p className="text-gray-700 mb-6">
            We're here to help! If you have any questions, concerns, or feedback about our
            services, please don't hesitate to reach out to us.
          </p>

          <div className="space-y-4">
            <div className="flex items-start">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">Phone</h3>
                <p className="text-gray-600">7005-0881</p>
                <p className="text-sm text-gray-500">Monday - Friday, 8:00 AM - 5:00 PM</p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">Email</h3>
                <p className="text-gray-600">ctogalasbranch@gmail.com</p>
                <p className="text-sm text-gray-500">We'll respond within 24 hours</p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mr-4 flex-shrink-0">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800 mb-1">Office Address</h3>
                <p className="text-gray-600">
                  39 Unang Hakbang<br />
                  St. Galas<br />
                  Quezon City
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <h2 className="text-2xl font-semibold text-primary-700 mb-4">Office Hours</h2>
          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b">
              <span className="font-semibold text-gray-700">Monday</span>
              <span className="text-gray-600">8:00 AM - 5:00 PM</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-semibold text-gray-700">Tuesday</span>
              <span className="text-gray-600">8:00 AM - 5:00 PM</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-semibold text-gray-700">Wednesday</span>
              <span className="text-gray-600">8:00 AM - 5:00 PM</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-semibold text-gray-700">Thursday</span>
              <span className="text-gray-600">8:00 AM - 5:00 PM</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-semibold text-gray-700">Friday</span>
              <span className="text-gray-600">8:00 AM - 5:00 PM</span>
            </div>
            <div className="flex justify-between py-2 border-b">
              <span className="font-semibold text-gray-700">Saturday</span>
              <span className="text-red-600">Closed</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="font-semibold text-gray-700">Sunday</span>
              <span className="text-red-600">Closed</span>
            </div>
          </div>

          <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-gray-700">
              <strong>Note:</strong> Office is closed on public holidays. Please check our
              announcements for any schedule changes.
            </p>
          </div>
        </div>
      </div>

      <div className="card bg-primary-50">
        <h2 className="text-2xl font-semibold text-primary-700 mb-4">Frequently Asked Questions</h2>
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">How do I get a queue number?</h3>
            <p className="text-gray-700">
              Visit our Queue System page, select the service you need, and click "Get Queue Number".
              You'll receive a unique number that you can use to track your position.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Can I check my queue status online?</h3>
            <p className="text-gray-700">
              Yes! Simply enter your queue number on the Queue System page to see your current
              position and estimated wait time.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">What if I miss my turn?</h3>
            <p className="text-gray-700">
              If you miss your turn, please approach the counter staff. They will assist you and
              may need to issue a new queue number depending on the situation.
            </p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-800 mb-2">Do I need to bring any documents?</h3>
            <p className="text-gray-700">
              Required documents vary by service. Please check the specific service description
              on our Services page or contact us for detailed requirements.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Contact
