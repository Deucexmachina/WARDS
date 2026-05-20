function About() {
  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-4xl font-bold text-gray-800 mb-6">About Us</h1>

      <div className="card mb-6">
        <h2 className="text-2xl font-semibold text-primary-700 mb-4">Our Mission</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Blablabla
        </p>
      </div>

      <div className="card mb-6">
        <h2 className="text-2xl font-semibold text-primary-700 mb-4">Our Vision</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          Blablabla 
        </p>
      </div>

      <div className="card mb-6">
        <h2 className="text-2xl font-semibold text-primary-700 mb-4">What We Do</h2>
        <p className="text-gray-700 leading-relaxed mb-4">
          WARDS provides a comprehensive queue management system that allows citizens to:
        </p>
        <ul className="list-disc list-inside text-gray-700 space-y-2 ml-4">
          <li>Take queue numbers online from the comfort of their homes</li>
          <li>Track their position in real-time</li>
          <li>Receive estimated wait times for various services</li>
          <li>Access important announcements and updates</li>
          <li>Plan their visits more effectively</li>
        </ul>
      </div>

      <div className="card mb-6">
        <h2 className="text-2xl font-semibold text-primary-700 mb-4">Our Values</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border-l-4 border-primary-500 pl-4">
            <h3 className="font-semibold text-lg mb-2">Transparency</h3>
            <p className="text-gray-600">
              We believe in open and honest communication with the public we serve.
            </p>
          </div>
          <div className="border-l-4 border-primary-500 pl-4">
            <h3 className="font-semibold text-lg mb-2">Efficiency</h3>
            <p className="text-gray-600">
              We strive to optimize processes and reduce unnecessary waiting times.
            </p>
          </div>
          <div className="border-l-4 border-primary-500 pl-4">
            <h3 className="font-semibold text-lg mb-2">Accessibility</h3>
            <p className="text-gray-600">
              Our services are designed to be accessible to all members of the community.
            </p>
          </div>
          <div className="border-l-4 border-primary-500 pl-4">
            <h3 className="font-semibold text-lg mb-2">Innovation</h3>
            <p className="text-gray-600">
              We embrace technology to continuously improve our service delivery.
            </p>
          </div>
        </div>
      </div>

      <div className="card bg-primary-50">
        <h2 className="text-2xl font-semibold text-primary-700 mb-4">Contact Information</h2>
        <p className="text-gray-700 mb-2">
          <strong>Office Hours:</strong> Monday - Friday, 8:00 AM - 5:00 PM
        </p>
        <p className="text-gray-700 mb-2">
          <strong>Email:</strong> ctogalasbranch@gmail.com
        </p>
        <p className="text-gray-700">
          <strong>Phone:</strong> 7005-0881
        </p>
      </div>
    </div>
  )
}

export default About
